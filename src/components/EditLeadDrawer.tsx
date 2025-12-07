import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { XMarkIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';

interface EditLeadDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  lead: {
    id: string | number;
    lead_number: string;
    name: string;
    lead_type?: 'new' | 'legacy';
    topic?: string;
    category?: string;
    source?: string;
    language?: string;
    probability?: number | null;
    number_of_applicants_meeting?: number | string | null;
    potential_applicants_meeting?: number | string | null;
    balance?: number | string | null;
    total?: number | string | null;
    balance_currency?: string | null;
    currency_id?: number | null;
    next_followup?: string | null;
    eligible?: boolean | null;
    tags?: string[] | null;
  } | null;
  onSave?: () => void;
}

const EditLeadDrawer: React.FC<EditLeadDrawerProps> = ({ isOpen, onClose, lead, onSave }) => {
  const [editLeadData, setEditLeadData] = useState({
    tags: '',
    source: '',
    name: '',
    language: '',
    category: '',
    topic: '',
    probability: 0,
    number_of_applicants_meeting: '',
    potential_applicants_meeting: '',
    balance: '',
    next_followup: '',
    balance_currency: '₪',
    eligible: true,
  });
  const [currentLeadTags, setCurrentLeadTags] = useState<string>('');
  const [mainCategories, setMainCategories] = useState<string[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [languagesList, setLanguagesList] = useState<string[]>([]);
  const [tagsList, setTagsList] = useState<string[]>([]);
  const [currencies, setCurrencies] = useState<Array<{id: string, front_name: string, iso_code: string, name: string}>>([]);

  // Fetch reference data on mount
  useEffect(() => {
    const fetchReferenceData = async () => {
      try {
        // Fetch currencies - try both new and legacy tables
        const [newCurrencies, legacyCurrencies] = await Promise.all([
          supabase.from('misc_currency').select('id, front_name, iso_code, name').order('name', { ascending: true }),
          supabase.from('accounting_currencies').select('id, iso_code, name').order('name', { ascending: true })
        ]);
        
        // Process currencies
        if (!newCurrencies.error && newCurrencies.data && newCurrencies.data.length > 0) {
          setCurrencies(newCurrencies.data);
        } else if (!legacyCurrencies.error && legacyCurrencies.data && legacyCurrencies.data.length > 0) {
          const transformedCurrencies = legacyCurrencies.data.map((currency: any) => ({
            id: currency.id.toString(),
            front_name: currency.iso_code === 'NIS' ? '₪' : currency.iso_code === 'EUR' ? '€' : currency.iso_code === 'USD' ? '$' : currency.iso_code === 'GBP' ? '£' : currency.iso_code,
            iso_code: currency.iso_code,
            name: currency.name
          }));
          setCurrencies(transformedCurrencies);
        } else {
          // Fallback to hardcoded currencies
          const fallbackCurrencies = [
            { id: '1', front_name: '₪', iso_code: 'NIS', name: '₪' },
            { id: '2', front_name: '€', iso_code: 'EUR', name: '€' },
            { id: '3', front_name: '$', iso_code: 'USD', name: '$' },
            { id: '4', front_name: '£', iso_code: 'GBP', name: '£' }
          ];
          setCurrencies(fallbackCurrencies);
        }

        // Fetch sources for dropdown
        const { data: sourcesData, error: sourcesError } = await supabase
          .from('misc_leadsource')
          .select('name')
          .order('name', { ascending: true });
        
        if (sourcesError) {
          console.error('Error fetching sources:', sourcesError);
        } else if (sourcesData) {
          setSources(sourcesData.map(s => s.name));
        }

        // Fetch languages for dropdown
        const { data: languagesData, error: languagesError } = await supabase
          .from('misc_language')
          .select('name')
          .order('name', { ascending: true });
        
        if (languagesError) {
          console.error('Error fetching languages:', languagesError);
        } else if (languagesData) {
          setLanguagesList(languagesData.map(l => l.name));
        }

        // Fetch categories for dropdown (formatted with main category)
        const { data: categoriesData, error: categoriesError } = await supabase
          .from('misc_category')
          .select(`
            id,
            name,
            parent_id,
            misc_maincategory!parent_id (
              id,
              name
            )
          `)
          .order('name', { ascending: true });
        
        if (categoriesError) {
          console.error('Error fetching categories:', categoriesError);
        } else if (categoriesData) {
          const formattedCategories = categoriesData.map((cat: any) => {
            return cat.misc_maincategory?.name 
              ? `${cat.name} (${cat.misc_maincategory.name})`
              : cat.name;
          });
          setMainCategories(formattedCategories);
        }

        // Fetch tags for dropdown
        const { data: tagsData, error: tagsError } = await supabase
          .from('misc_leadtag')
          .select('name')
          .order('name', { ascending: true });
        
        if (tagsError) {
          console.error('Error fetching tags:', tagsError);
        } else if (tagsData) {
          setTagsList(tagsData.map(t => t.name));
        }
      } catch (error) {
        console.error('Error fetching reference data:', error);
      }
    };

    fetchReferenceData();
  }, []);

  // Load lead data when drawer opens
  useEffect(() => {
    if (isOpen && lead) {
      loadLeadData();
    }
  }, [isOpen, lead]);

  const getCurrencySymbol = (currencyId: string | number | null | undefined, fallbackCurrency?: string) => {
    if (currencyId && currencies.length > 0) {
      const currency = currencies.find(c => c.id === String(currencyId));
      return currency ? currency.name : fallbackCurrency || '₪';
    }
    return fallbackCurrency || '₪';
  };

  const loadLeadData = async () => {
    if (!lead) return;

    try {
      // Fetch detailed lead data
      const isLegacyLead = lead.lead_type === 'legacy' || (!lead.lead_type && (lead.id.toString().startsWith('legacy_') || (!lead.id.toString().includes('-') && /^\d+$/.test(lead.id.toString()))));
      const leadId = isLegacyLead 
        ? (typeof lead.id === 'string' ? parseInt(lead.id.replace('legacy_', '')) : lead.id)
        : lead.id;
      
      let leadDetails: any = null;
      
      if (isLegacyLead) {
        const { data, error } = await supabase
          .from('leads_lead')
          .select('name, topic, probability, no_of_applicants, total, next_followup, currency_id, eligibile, source_id, language_id, category_id')
          .eq('id', leadId)
          .single();
        
        if (error) {
          console.error('Error fetching legacy lead details:', error);
          toast.error('Failed to load lead details');
          return;
        }
        
        leadDetails = data;
        
        // Fetch source and language names for legacy leads
        let sourceName = '';
        let languageName = '';
        
        if (leadDetails?.source_id) {
          const { data: sourceData } = await supabase
            .from('misc_leadsource')
            .select('name')
            .eq('id', leadDetails.source_id)
            .single();
          sourceName = sourceData?.name || '';
        }
        
        if (leadDetails?.language_id) {
          const { data: languageData } = await supabase
            .from('misc_language')
            .select('name')
            .eq('id', leadDetails.language_id)
            .single();
          languageName = languageData?.name || '';
        }
        
        leadDetails.source = sourceName;
        leadDetails.language = languageName;
      } else {
        const { data, error } = await supabase
          .from('leads')
          .select('name, topic, probability, number_of_applicants_meeting, potential_applicants_meeting, balance, next_followup, balance_currency, eligible, source, language, category_id')
          .eq('id', leadId)
          .single();
        
        if (error) {
          console.error('Error fetching new lead details:', error);
          toast.error('Failed to load lead details');
          return;
        }
        
        leadDetails = data;
      }
      
      // Get category name
      const categoryName = lead.category || '';
      
      // Get currency
      const currentCurrency = getCurrencySymbol(
        leadDetails?.currency_id || leadDetails?.balance_currency,
        lead.balance_currency || '₪'
      );
      
      // Reset the edit form data with current lead data
      setEditLeadData({
        tags: '',
        source: leadDetails?.source || lead.source || '',
        name: leadDetails?.name || lead.name || '',
        language: leadDetails?.language || lead.language || '',
        category: categoryName,
        topic: leadDetails?.topic || lead.topic || '',
        probability: leadDetails?.probability || lead.probability || 0,
        number_of_applicants_meeting: isLegacyLead 
          ? (leadDetails?.no_of_applicants || lead.number_of_applicants_meeting || '')
          : (leadDetails?.number_of_applicants_meeting || lead.number_of_applicants_meeting || ''),
        potential_applicants_meeting: isLegacyLead 
          ? (lead.potential_applicants_meeting || '') // Legacy leads might not have this field
          : (leadDetails?.potential_applicants_meeting || lead.potential_applicants_meeting || ''),
        balance: leadDetails?.total || leadDetails?.balance || lead.balance || lead.total || '',
        next_followup: leadDetails?.next_followup || lead.next_followup || '',
        balance_currency: currentCurrency,
        eligible: isLegacyLead 
          ? (leadDetails?.eligibile !== 'no' && leadDetails?.eligibile !== false && lead.eligible !== false)
          : (leadDetails?.eligible !== false && lead.eligible !== false),
      });
      
      // Fetch current lead's tags
      const leadIdForTags = isLegacyLead ? `legacy_${leadId}` : leadId;
      await fetchCurrentLeadTags(leadIdForTags);
    } catch (error) {
      console.error('Error loading lead data:', error);
      toast.error('Failed to load lead data');
    }
  };

  const fetchCurrentLeadTags = async (leadId: string | number) => {
    try {
      // Check if it's a legacy lead
      const isLegacyLead = leadId.toString().startsWith('legacy_') || (!leadId.toString().includes('-') && /^\d+$/.test(leadId.toString()));
      
      if (isLegacyLead) {
        const legacyId = parseInt(leadId.toString().replace('legacy_', ''));
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
          
          // Join tags with comma and space
          const tagsString = tags.join(', ');
          setCurrentLeadTags(tagsString);
        } else {
          console.error('❌ Error fetching current lead tags (legacy):', error);
          setCurrentLeadTags('');
        }
      } else {
        // For new leads, fetch from leads_lead_tags table using newlead_id
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
          
          // Join tags with comma and space
          const tagsString = tags.join(', ');
          setCurrentLeadTags(tagsString);
        } else {
          console.error('❌ Error fetching current lead tags (new):', error);
          setCurrentLeadTags('');
        }
      }
    } catch (error) {
      console.error('❌ Error fetching current lead tags:', error);
      setCurrentLeadTags('');
    }
  };

  const saveLeadTags = async (leadId: string | number, tagsString: string) => {
    try {
      const isLegacyLead = leadId.toString().startsWith('legacy_') || (!leadId.toString().includes('-') && /^\d+$/.test(leadId.toString()));
      
      if (isLegacyLead) {
        const legacyId = parseInt(leadId.toString().replace('legacy_', ''));
        
        // First, remove all existing tags for this legacy lead
        const { error: deleteError } = await supabase
          .from('leads_lead_tags')
          .delete()
          .eq('lead_id', legacyId);
        
        if (deleteError) {
          console.error('❌ Error deleting existing tags (legacy):', deleteError);
          return;
        }
        
        // Parse the tags string and find matching tag IDs
        if (tagsString.trim()) {
          const tagNames = tagsString.split(',').map(tag => tag.trim()).filter(tag => tag);
          
          // Fetch tag IDs for the provided tag names
          const tagQueries = tagNames.map(tagName => 
            supabase.from('misc_leadtag').select('id').eq('name', tagName).single()
          );
          
          const tagIdResults = await Promise.all(tagQueries);
          const validTagIds = tagIdResults
            .filter(result => !result.error && result.data)
            .map(result => (result.data as any).id);
          
          // Insert new tags for legacy lead
          if (validTagIds.length > 0) {
            const tagInserts = validTagIds.map(tagId => ({
              lead_id: legacyId,
              leadtag_id: tagId
            }));
            
            const { error: insertError } = await supabase
              .from('leads_lead_tags')
              .insert(tagInserts);
            
            if (insertError) {
              console.error('❌ Error inserting new tags (legacy):', insertError);
              return;
            }
          }
        }
      } else {
        // For new leads, remove all existing tags first
        const { error: deleteError } = await supabase
          .from('leads_lead_tags')
          .delete()
          .eq('newlead_id', leadId);
        
        if (deleteError) {
          console.error('❌ Error deleting existing tags (new):', deleteError);
          return;
        }
        
        // Parse the tags string and find matching tag IDs
        if (tagsString.trim()) {
          const tagNames = tagsString.split(',').map(tag => tag.trim()).filter(tag => tag);
          
          // Fetch tag IDs for the provided tag names
          const tagQueries = tagNames.map(tagName => 
            supabase.from('misc_leadtag').select('id').eq('name', tagName).single()
          );
          
          const tagIdResults = await Promise.all(tagQueries);
          const validTagIds = tagIdResults
            .filter(result => !result.error && result.data)
            .map(result => (result.data as any).id);
          
          // Insert new tags for new lead
          if (validTagIds.length > 0) {
            const tagInserts = validTagIds.map(tagId => ({
              newlead_id: leadId,
              leadtag_id: tagId
            }));
            
            const { error: insertError } = await supabase
              .from('leads_lead_tags')
              .insert(tagInserts);
            
            if (insertError) {
              console.error('❌ Error inserting new tags (new):', insertError);
              return;
            }
          }
        }
      }
    } catch (error) {
      console.error('❌ Error saving tags:', error);
    }
  };

  const fetchCurrentUserFullName = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.email) {
        const { data: userData, error } = await supabase
          .from('users')
          .select('full_name')
          .eq('email', user.email)
          .single();
        
        if (error) {
          console.error('Error fetching user full name:', error);
          return user.email;
        }
        
        return userData?.full_name || user.email;
      }
      return 'Unknown User';
    } catch (error) {
      console.error('Error in fetchCurrentUserFullName:', error);
      return 'Unknown User';
    }
  };

  const handleEditLeadChange = (field: string, value: any) => {
    setEditLeadData(prev => ({ ...prev, [field]: value }));
  };

  const handleSaveEditLead = async () => {
    if (!lead) return;
    
    // Check if this is a legacy lead
    const isLegacyLead = lead.lead_type === 'legacy' || (!lead.lead_type && (lead.id.toString().startsWith('legacy_') || (!lead.id.toString().includes('-') && /^\d+$/.test(lead.id.toString()))));
    
    try {
      // Get current user name from Supabase users table
      const currentUserName = await fetchCurrentUserFullName();
      
      // Create update data based on whether it's a legacy lead or not
      let updateData: any = {};
      
      if (isLegacyLead) {
        // For legacy leads, only include fields that exist in leads_lead table
        const currencyNameToId = (currencyName: string): number | null => {
          switch (currencyName) {
            case '₪': return 1; // NIS
            case '€': return 2; // EUR  
            case '$': return 3; // USD
            case '£': return 4; // GBP
            default: return 1; // Default to NIS
          }
        };
        
        const legacyId = typeof lead.id === 'string' ? parseInt(lead.id.replace('legacy_', '')) : lead.id;
        
        // Fetch current lead data to compare
        const { data: currentData } = await supabase
          .from('leads_lead')
          .select('name, topic, probability, no_of_applicants, total, next_followup, currency_id, eligibile, source_id, language_id, category_id')
          .eq('id', legacyId)
          .single();
        
        // Fetch current source and language names for comparison
        let currentSourceName = '';
        let currentLanguageName = '';
        if (currentData?.source_id) {
          const { data: sourceData } = await supabase
            .from('misc_leadsource')
            .select('name')
            .eq('id', currentData.source_id)
            .single();
          currentSourceName = sourceData?.name || '';
        }
        if (currentData?.language_id) {
          const { data: languageData } = await supabase
            .from('misc_language')
            .select('name')
            .eq('id', currentData.language_id)
            .single();
          currentLanguageName = languageData?.name || '';
        }
        
        if (currentData) {
          if (editLeadData.name !== currentData.name) {
            updateData.name = editLeadData.name;
          }
          if (editLeadData.topic !== currentData.topic) {
            updateData.topic = editLeadData.topic;
          }
          if (editLeadData.probability !== currentData.probability) {
            let probabilityValue = null;
            if (editLeadData.probability !== null && editLeadData.probability !== undefined) {
              const parsed = Number(editLeadData.probability);
              probabilityValue = isNaN(parsed) ? null : parsed;
            }
            updateData.probability = probabilityValue;
          }
          if (editLeadData.number_of_applicants_meeting !== (currentData.no_of_applicants || '')) {
            let applicantsValue = null;
            if (editLeadData.number_of_applicants_meeting !== '' && editLeadData.number_of_applicants_meeting !== null) {
              const parsed = Number(editLeadData.number_of_applicants_meeting);
              applicantsValue = isNaN(parsed) ? null : parsed;
            }
            updateData.no_of_applicants = applicantsValue;
          }
          // Legacy leads don't have potential_applicants_meeting field, so skip it
          if (editLeadData.balance !== (currentData.total || '')) {
            const balanceValue = editLeadData.balance === '' || editLeadData.balance === null ? null : String(editLeadData.balance);
            updateData.total = balanceValue;
          }
          if (editLeadData.next_followup !== currentData.next_followup) {
            const followupValue = editLeadData.next_followup === '' || editLeadData.next_followup === null ? 
              new Date().toISOString().split('T')[0] : editLeadData.next_followup;
            updateData.next_followup = followupValue;
          }
          if (editLeadData.balance_currency !== getCurrencySymbol(currentData.currency_id)) {
            updateData.currency_id = currencyNameToId(editLeadData.balance_currency);
          }
          if (editLeadData.category !== lead.category) {
            // Find category ID from mainCategories
            const categoryName = editLeadData.category.includes(' (') ? editLeadData.category.split(' (')[0] : editLeadData.category;
            const { data: categoryData } = await supabase
              .from('misc_category')
              .select('id')
              .eq('name', categoryName)
              .single();
            
            if (categoryData) {
              updateData.category_id = categoryData.id;
            }
          }
          // Compare eligibile (with typo) field for legacy leads
          const currentEligibleValue = currentData.eligibile === 'yes' || currentData.eligibile === true;
          if (editLeadData.eligible !== currentEligibleValue) {
            updateData.eligibile = editLeadData.eligible ? 'yes' : 'no';
          }
          // Handle source - convert name to ID for legacy leads
          if (editLeadData.source !== currentSourceName) {
            if (editLeadData.source && editLeadData.source.trim()) {
              const { data: sourceData } = await supabase
                .from('misc_leadsource')
                .select('id')
                .eq('name', editLeadData.source)
                .single();
              if (sourceData) {
                updateData.source_id = sourceData.id;
              }
            } else {
              updateData.source_id = null;
            }
          }
          // Handle language - convert name to ID for legacy leads
          if (editLeadData.language !== currentLanguageName) {
            if (editLeadData.language && editLeadData.language.trim()) {
              const { data: languageData } = await supabase
                .from('misc_language')
                .select('id')
                .eq('name', editLeadData.language)
                .single();
              if (languageData) {
                updateData.language_id = languageData.id;
              }
            } else {
              updateData.language_id = null;
            }
          }
        }
      } else {
        // For new leads
        const leadId = lead.id;
        
        // Fetch current lead data to compare
        const { data: currentData } = await supabase
          .from('leads')
          .select('name, topic, probability, number_of_applicants_meeting, potential_applicants_meeting, balance, next_followup, balance_currency, eligible, source, language, category_id')
          .eq('id', leadId)
          .single();
        
        if (currentData) {
          if (editLeadData.source !== currentData.source) {
            updateData.source = editLeadData.source;
          }
          if (editLeadData.name !== currentData.name) {
            updateData.name = editLeadData.name;
          }
          if (editLeadData.language !== currentData.language) {
            updateData.language = editLeadData.language;
          }
          if (editLeadData.category !== lead.category) {
            // Find category ID from mainCategories
            const categoryName = editLeadData.category.includes(' (') ? editLeadData.category.split(' (')[0] : editLeadData.category;
            const { data: categoryData } = await supabase
              .from('misc_category')
              .select('id')
              .eq('name', categoryName)
              .single();
            
            if (categoryData) {
              updateData.category_id = categoryData.id;
            }
          }
          if (editLeadData.topic !== currentData.topic) {
            updateData.topic = editLeadData.topic;
          }
          if (editLeadData.probability !== currentData.probability) {
            let probabilityValue = null;
            if (editLeadData.probability !== null && editLeadData.probability !== undefined) {
              const parsed = Number(editLeadData.probability);
              probabilityValue = isNaN(parsed) ? null : parsed;
            }
            updateData.probability = probabilityValue;
          }
          if (editLeadData.number_of_applicants_meeting !== (currentData.number_of_applicants_meeting || '')) {
            let applicantsValue = null;
            if (editLeadData.number_of_applicants_meeting !== '' && editLeadData.number_of_applicants_meeting !== null) {
              const parsed = Number(editLeadData.number_of_applicants_meeting);
              applicantsValue = isNaN(parsed) ? null : parsed;
            }
            updateData.number_of_applicants_meeting = applicantsValue;
          }
          if (editLeadData.potential_applicants_meeting !== (currentData.potential_applicants_meeting || '')) {
            let potentialValue = null;
            if (editLeadData.potential_applicants_meeting !== '' && editLeadData.potential_applicants_meeting !== null) {
              const parsed = Number(editLeadData.potential_applicants_meeting);
              potentialValue = isNaN(parsed) ? null : parsed;
            }
            updateData.potential_applicants_meeting = potentialValue;
          }
          if (editLeadData.balance !== (currentData.balance || '')) {
            let balanceValue = null;
            if (editLeadData.balance !== '' && editLeadData.balance !== null) {
              const parsed = Number(editLeadData.balance);
              balanceValue = isNaN(parsed) ? null : parsed;
            }
            updateData.balance = balanceValue;
          }
          if (editLeadData.next_followup !== currentData.next_followup) {
            const followupValue = editLeadData.next_followup === '' || editLeadData.next_followup === null ? 
              new Date().toISOString().split('T')[0] : editLeadData.next_followup;
            updateData.next_followup = followupValue;
          }
          if (editLeadData.balance_currency !== currentData.balance_currency) {
            updateData.balance_currency = editLeadData.balance_currency;
          }
          if (editLeadData.eligible !== currentData.eligible) {
            updateData.eligible = editLeadData.eligible;
          }
        }
      }
      
      // Save tags if they were changed
      const leadIdForTags = isLegacyLead ? `legacy_${typeof lead.id === 'string' ? lead.id.replace('legacy_', '') : lead.id}` : lead.id;
      if (currentLeadTags !== '') {
        await saveLeadTags(leadIdForTags, currentLeadTags);
      }
      
      // If no changes were detected, don't proceed with the update
      if (Object.keys(updateData).length === 0 && currentLeadTags === '') {
        onClose();
        if (onSave) onSave();
        toast.success('Lead updated!');
        return;
      }
      
      let updateError;
      
      if (isLegacyLead) {
        // For legacy leads, update the leads_lead table
        const legacyId = typeof lead.id === 'string' ? parseInt(lead.id.replace('legacy_', '')) : lead.id;
        
        const { error } = await supabase
          .from('leads_lead')
          .update(updateData)
          .eq('id', legacyId);
        
        updateError = error;
      } else {
        // For regular leads, update the leads table
        const { error } = await supabase
          .from('leads')
          .update(updateData)
          .eq('id', lead.id);
        
        updateError = error;
      }
        
      if (updateError) {
        console.error('Error updating lead:', updateError);
        toast.error('Failed to update lead.');
        return;
      }
      
      // Log the changes to lead_changes table (only for regular leads)
      if (!isLegacyLead) {
        const changesToInsert = [];
        const fieldsToTrack = Object.keys(updateData);
        
        for (const field of fieldsToTrack) {
          const oldValue = (lead as any)[field] || '';
          const newValue = updateData[field] || '';
          
          changesToInsert.push({
            lead_id: lead.id,
            field_name: field,
            old_value: String(oldValue),
            new_value: String(newValue),
            changed_by: currentUserName,
            changed_at: new Date().toISOString()
          });
        }
        
        if (changesToInsert.length > 0) {
          const { error: historyError } = await supabase
            .from('lead_changes')
            .insert(changesToInsert);
          
          if (historyError) {
            console.error('Error logging lead changes:', historyError);
          }
        }
      }
      
      onClose();
      if (onSave) onSave();
      toast.success('Lead updated!');
      
    } catch (error) {
      console.error('Error in handleSaveEditLead:', error);
      toast.error('Failed to update lead.');
    }
  };

  if (!isOpen || !lead) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Overlay */}
      <div className="fixed inset-0 bg-black/30" onClick={onClose} />
      {/* Drawer */}
      <div className="ml-auto w-full max-w-md bg-base-100 h-full shadow-2xl p-8 flex flex-col animate-slideInRight z-50">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-2xl font-bold">Edit Lead</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            <XMarkIcon className="w-6 h-6" />
          </button>
        </div>
        <div className="flex flex-col gap-4 flex-1 overflow-y-auto">
          <div>
            <label className="block font-semibold mb-1">Tags</label>
            <input
              type="text"
              className="input input-bordered w-full"
              placeholder="Search or select tags..."
              value={currentLeadTags}
              onChange={e => setCurrentLeadTags(e.target.value)}
              list="tags-options"
            />
            <datalist id="tags-options">
              {tagsList.map((name, index) => (
                <option key={`${name}-${index}`} value={name} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="block font-semibold mb-1">Source</label>
            <input
              type="text"
              className="input input-bordered w-full"
              placeholder="Search or select a source..."
              value={editLeadData.source}
              onChange={e => handleEditLeadChange('source', e.target.value)}
              list="source-options"
            />
            <datalist id="source-options">
              {sources.map((name, index) => (
                <option key={`${name}-${index}`} value={name} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="block font-semibold mb-1">Client Name</label>
            <input type="text" className="input input-bordered w-full" value={editLeadData.name} onChange={e => handleEditLeadChange('name', e.target.value)} />
          </div>
          <div>
            <label className="block font-semibold mb-1">Language</label>
            <input
              type="text"
              className="input input-bordered w-full"
              placeholder="Search or select a language..."
              value={editLeadData.language}
              onChange={e => handleEditLeadChange('language', e.target.value)}
              list="language-options"
            />
            <datalist id="language-options">
              {languagesList.map((name, index) => (
                <option key={`${name}-${index}`} value={name} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="block font-semibold mb-1">Category</label>
            <input
              type="text"
              className="input input-bordered w-full"
              placeholder="Search or select a category..."
              value={editLeadData.category}
              onChange={e => handleEditLeadChange('category', e.target.value)}
              list="category-options"
            />
            <datalist id="category-options">
              {mainCategories.map((name, index) => (
                <option key={`${name}-${index}`} value={name} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="block font-semibold mb-1">Topic</label>
            <input type="text" className="input input-bordered w-full" value={editLeadData.topic} onChange={e => handleEditLeadChange('topic', e.target.value)} />
          </div>
          <div>
            <label className="block font-semibold mb-1">Probability</label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="0"
                max="100"
                className="range range-primary flex-1"
                value={editLeadData.probability || 0}
                onChange={e => handleEditLeadChange('probability', parseInt(e.target.value))}
              />
              <span className="text-sm font-medium text-gray-700 min-w-[50px] text-right">
                {editLeadData.probability || 0}%
              </span>
            </div>
          </div>
          <div>
            <label className="block font-semibold mb-1">Number of Applicants</label>
            <input type="number" min="0" className="input input-bordered w-full" value={editLeadData.number_of_applicants_meeting} onChange={e => handleEditLeadChange('number_of_applicants_meeting', e.target.value)} />
          </div>
          <div>
            <label className="block font-semibold mb-1">Potential Applicants</label>
            <input type="number" min="0" className="input input-bordered w-full" value={editLeadData.potential_applicants_meeting} onChange={e => handleEditLeadChange('potential_applicants_meeting', e.target.value)} />
          </div>
          <div>
            <label className="block font-semibold mb-1">Balance (Amount)</label>
            <input type="number" min="0" className="input input-bordered w-full" value={editLeadData.balance} onChange={e => handleEditLeadChange('balance', e.target.value)} />
          </div>
          <div>
            <label className="block font-semibold mb-1">Follow Up Date</label>
            <input type="date" className="input input-bordered w-full" value={editLeadData.next_followup} onChange={e => handleEditLeadChange('next_followup', e.target.value)} />
          </div>
          <div>
            <label className="block font-semibold mb-1">Balance Currency</label>
            <div className="dropdown w-full">
              <div tabIndex={0} role="button" className="btn btn-outline w-full justify-between">
                {editLeadData.balance_currency || 'Select Currency'}
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
              <ul tabIndex={0} className="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-full max-h-60 overflow-y-auto">
                {currencies.length > 0 ? (
                  <>
                    {/* Show current currency first */}
                    {currencies
                      .filter(currency => currency.name === editLeadData.balance_currency)
                      .map((currency) => (
                        <li key={`current-${currency.id}`}>
                          <a onClick={() => handleEditLeadChange('balance_currency', currency.name)}>
                            {currency.name} ({currency.iso_code})
                          </a>
                        </li>
                      ))
                    }
                    {/* Show other currencies */}
                    {currencies
                      .filter(currency => currency.name !== editLeadData.balance_currency)
                      .map((currency) => (
                        <li key={currency.id}>
                          <a onClick={() => handleEditLeadChange('balance_currency', currency.name)}>
                            {currency.name} ({currency.iso_code})
                          </a>
                        </li>
                      ))
                    }
                  </>
                ) : (
                  <li><a>Loading currencies...</a></li>
                )}
              </ul>
            </div>
          </div>
          <div>
            <label className="block font-semibold mb-1">Eligible</label>
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                className="toggle toggle-success"
                checked={editLeadData.eligible}
                onChange={(e) => handleEditLeadChange('eligible', e.target.checked)}
              />
              <span className="text-sm font-medium text-gray-700">
                {editLeadData.eligible ? 'Yes' : 'No'}
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {editLeadData.eligible ? 'Eligible leads will be removed from the scheduler view' : 'Ineligible leads will be shown in the scheduler view'}
            </p>
          </div>
        </div>
        <div className="mt-6 flex justify-end">
          <button className="btn btn-primary px-8" onClick={handleSaveEditLead}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
};

export default EditLeadDrawer;

