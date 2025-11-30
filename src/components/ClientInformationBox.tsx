import React, { useState, useEffect } from 'react';
import { UserIcon, PencilIcon } from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';

interface ClientInformationBoxProps {
  selectedClient: any;
  getEmployeeDisplayName?: (employeeId: string | null | undefined) => string;
  onClientUpdate?: () => Promise<void>;
}

const ClientInformationBox: React.FC<ClientInformationBoxProps> = ({ selectedClient, getEmployeeDisplayName, onClientUpdate }) => {
  const [legacyContactInfo, setLegacyContactInfo] = useState<{email: string | null, phone: string | null}>({
    email: null,
    phone: null
  });
  const [isEditingCategory, setIsEditingCategory] = useState(false);
  const [allCategories, setAllCategories] = useState<any[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [isLoadingCategories, setIsLoadingCategories] = useState(false);
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const [categoryInputValue, setCategoryInputValue] = useState<string>('');

  // Fetch categories
  useEffect(() => {
    const fetchCategories = async () => {
      try {
        setIsLoadingCategories(true);
        const { data, error } = await supabase
          .from('misc_category')
          .select(`
            id,
            name,
            misc_maincategory (
              id,
              name
            )
          `)
          .order('name');

        if (error) throw error;
        setAllCategories(data || []);
      } catch (error) {
        console.error('Error fetching categories:', error);
        toast.error('Failed to load categories');
      } finally {
        setIsLoadingCategories(false);
      }
    };

    fetchCategories();
  }, []);

  // Handle category save
  const handleSaveCategory = async () => {
    if (!selectedClient || !categoryInputValue.trim()) return;

    try {
      const isLegacyLead = selectedClient?.lead_type === 'legacy' || selectedClient?.id?.toString().startsWith('legacy_');
      const tableName = isLegacyLead ? 'leads_lead' : 'leads';
      const idField = isLegacyLead ? 'id' : 'id';
      const clientId = isLegacyLead ? selectedClient.id.toString().replace('legacy_', '') : selectedClient.id;

      // Find the category by the input value
      const foundCategory = allCategories.find((cat: any) => {
        const expectedFormat = cat.misc_maincategory?.name 
          ? `${cat.name} (${cat.misc_maincategory.name})`
          : cat.name;
        return expectedFormat.toLowerCase().includes(categoryInputValue.toLowerCase()) ||
               cat.name.toLowerCase().includes(categoryInputValue.toLowerCase());
      });

      if (!foundCategory) {
        toast.error('Category not found. Please select from the dropdown.');
        return;
      }

      const updateData: any = {
        category_id: foundCategory.id,
        category: foundCategory.name,
        category_last_edited_by: await getCurrentUserName(),
        category_last_edited_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from(tableName)
        .update(updateData)
        .eq(idField, clientId);

      if (error) throw error;

      toast.success('Category updated successfully');
      setIsEditingCategory(false);
      setShowCategoryDropdown(false);
      setCategoryInputValue('');
      
      // Refresh client data
      if (onClientUpdate) {
        await onClientUpdate();
      }
    } catch (error) {
      console.error('Error updating category:', error);
      toast.error('Failed to update category');
    }
  };

  // Helper function to get category display name with main category
  const getCategoryDisplayName = (categoryId: string | number | null | undefined, fallbackCategory?: string) => {
    if (!categoryId || categoryId === '---') {
      // If no category_id but we have a fallback category, try to find it in the loaded categories
      if (fallbackCategory && fallbackCategory.trim() !== '') {
        const foundCategory = allCategories.find((cat: any) => 
          cat.name.toLowerCase().trim() === fallbackCategory.toLowerCase().trim()
        );
        
        if (foundCategory) {
          // Return category name with main category in parentheses
          if (foundCategory.misc_maincategory?.name) {
            return `${foundCategory.name} (${foundCategory.misc_maincategory.name})`;
          } else {
            return foundCategory.name; // Fallback if no main category
          }
        } else {
          return fallbackCategory; // Use as-is if not found in loaded categories
        }
      }
      return '';
    }
    
    // Find category in loaded categories
    const category = allCategories.find((cat: any) => cat.id.toString() === categoryId.toString());
    
    if (category) {
      // Return category name with main category in parentheses
      if (category.misc_maincategory?.name) {
        return `${category.name} (${category.misc_maincategory.name})`;
      } else {
        return category.name; // Fallback if no main category
      }
    }
    
    // Fallback to the category name if category_id not found
    return fallbackCategory || '';
  };

  // Filter categories based on input
  const filteredCategories = allCategories.filter((category) => {
    const categoryName = category.misc_maincategory?.name 
      ? `${category.name} (${category.misc_maincategory.name})`
      : category.name;
    return categoryName.toLowerCase().includes(categoryInputValue.toLowerCase());
  });

  // Handle click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.category-dropdown-container')) {
        setShowCategoryDropdown(false);
      }
    };

    if (showCategoryDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showCategoryDropdown]);

  // Get current user name
  const getCurrentUserName = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.email) {
        const { data: userRow } = await supabase
          .from('users')
          .select('full_name')
          .eq('email', user.email)
          .single();
        return userRow?.full_name || user.email;
      }
      return 'System User';
    } catch (error) {
      console.error('Error getting user name:', error);
      return 'System User';
    }
  };

  // Fetch contact info for legacy leads
  useEffect(() => {
    const fetchLegacyContactInfo = async () => {
      if (!selectedClient) return;
      
      const isLegacyLead = selectedClient?.lead_type === 'legacy' || selectedClient?.id?.toString().startsWith('legacy_');
      
      if (isLegacyLead) {
        const legacyId = selectedClient.id.toString().replace('legacy_', '');
        
        try {
          // For legacy leads, we need to get the main contact from leads_contact table
          // via the lead_leadcontact relationship
          // First try to get the main contact
          const { data: leadContacts, error: leadContactsError } = await supabase
            .from('lead_leadcontact')
            .select(`
              main,
              contact_id
            `)
            .eq('lead_id', legacyId)
            .eq('main', 'true'); // Get the main contact
          
          if (leadContactsError) {
            console.error('Error fetching legacy lead contacts:', leadContactsError);
            return;
          }
          
          console.log('🔍 ClientInformationBox - Lead contacts query result:', { leadContacts, leadContactsError });
          
          if (leadContacts && leadContacts.length > 0) {
            const mainContactId = leadContacts[0].contact_id;
            console.log('🔍 ClientInformationBox - Main contact ID found:', mainContactId);
            
            // Fetch the contact details
            const { data: contactData, error: contactError } = await supabase
              .from('leads_contact')
              .select('email, phone')
              .eq('id', mainContactId)
              .single();
            
            if (!contactError && contactData) {
              console.log('🔍 ClientInformationBox - Setting legacy contact info:', contactData);
              setLegacyContactInfo({
                email: contactData.email,
                phone: contactData.phone
              });
            } else {
              console.log('🔍 ClientInformationBox - No contact data found:', { contactError, contactData });
            }
          } else {
            console.log('🔍 ClientInformationBox - No main contact found, trying to get any contact');
            
            // Try to get any contact for this lead
            const { data: anyLeadContacts, error: anyLeadContactsError } = await supabase
              .from('lead_leadcontact')
              .select(`
                main,
                contact_id
              `)
              .eq('lead_id', legacyId)
              .limit(1);
            
            if (!anyLeadContactsError && anyLeadContacts && anyLeadContacts.length > 0) {
              const contactId = anyLeadContacts[0].contact_id;
              console.log('🔍 ClientInformationBox - Found any contact ID:', contactId);
              
              const { data: contactData, error: contactError } = await supabase
                .from('leads_contact')
                .select('email, phone')
                .eq('id', contactId)
                .single();
              
              if (!contactError && contactData) {
                console.log('🔍 ClientInformationBox - Setting any contact info:', contactData);
                setLegacyContactInfo({
                  email: contactData.email,
                  phone: contactData.phone
                });
              } else {
                console.log('🔍 ClientInformationBox - No contact data found for any contact:', { contactError, contactData });
              }
            } else {
              // Final fallback to leads_lead table
              const { data: legacyData, error } = await supabase
                .from('leads_lead')
                .select('email, phone')
                .eq('id', legacyId)
                .single();
              
              if (!error && legacyData) {
                console.log('🔍 ClientInformationBox - Setting final fallback legacy contact info:', legacyData);
                setLegacyContactInfo({
                  email: legacyData.email,
                  phone: legacyData.phone
                });
              } else {
                console.log('🔍 ClientInformationBox - No final fallback data found:', { error, legacyData });
              }
            }
          }
        } catch (error) {
          console.error('Error fetching legacy contact info:', error);
        }
      }
    };

    fetchLegacyContactInfo();
  }, [selectedClient]);

  // Get the display values - use legacy contact info if available, otherwise use client data
  const displayEmail = legacyContactInfo.email || selectedClient?.email;
  const displayPhone = legacyContactInfo.phone || selectedClient?.phone;
  
  // Debug logging
  console.log('🔍 ClientInformationBox - Contact display logic:', {
    selectedClientId: selectedClient?.id,
    legacyContactInfo,
    selectedClientEmail: selectedClient?.email,
    selectedClientPhone: selectedClient?.phone,
    displayEmail,
    displayPhone
  });
  return (
    <div className="text-black">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: '#391BC8' }}>
          <UserIcon className="w-5 h-5 text-white" />
        </div>
        <div className="flex flex-col flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold text-gray-900">
              {selectedClient ? (() => {
                // Prefer the formatted lead number (e.g. "L18/2"), fall back to manual_id and finally to id
                let displayNumber = selectedClient.lead_number || selectedClient.manual_id || selectedClient.id || '---';
                
                // Show "C" prefix in UI for both new and legacy leads when stage is Success (100)
                const isSuccessStage = selectedClient.stage === '100' || selectedClient.stage === 100;
                if (isSuccessStage && displayNumber && !displayNumber.toString().startsWith('C')) {
                  // Replace "L" prefix with "C" for display only
                  displayNumber = displayNumber.toString().replace(/^L/, 'C');
                }
                
                return displayNumber;
              })() : '---'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-2xl font-bold text-gray-700 truncate max-w-[200px]">
              {selectedClient ? (selectedClient.name || '---') : '---'}
            </span>
            {selectedClient?.language && (
              <span className="px-3 py-1 text-sm font-semibold text-white bg-gradient-to-r from-pink-500 via-purple-500 to-purple-600 rounded-full">
                {selectedClient.language}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {/* Email */}
        <div className="flex justify-between items-center pb-2 border-b border-gray-200 last:border-b-0">
          <p className="text-sm font-medium uppercase tracking-wide bg-gradient-to-r from-purple-500 to-purple-600 text-transparent bg-clip-text">Email</p>
          <a href={displayEmail ? `mailto:${displayEmail}` : undefined} className="text-sm text-gray-900 text-right break-all">
            {displayEmail || '---'}
          </a>
        </div>

        {/* Phone */}
        <div className="flex justify-between items-center pb-2 border-b border-gray-200 last:border-b-0">
          <p className="text-sm font-medium uppercase tracking-wide bg-gradient-to-r from-purple-500 to-purple-600 text-transparent bg-clip-text">Phone</p>
          <a href={displayPhone ? `tel:${displayPhone}` : undefined} className="text-sm text-gray-900 text-right">
            {displayPhone || '---'}
          </a>
        </div>

        {/* Category */}
        <div className="pb-2 border-b border-gray-200 last:border-b-0">
          <div className="flex justify-between items-center">
            <p className="text-sm font-medium uppercase tracking-wide bg-gradient-to-r from-purple-500 to-purple-600 text-transparent bg-clip-text">Category</p>
            <div className="flex items-center gap-2">
              <p className="text-sm text-black text-right">
                {selectedClient ? getCategoryDisplayName(selectedClient.category_id, selectedClient.category) || 'Not specified' : 'Not specified'}
              </p>
              {(!selectedClient?.category_id && !selectedClient?.category) && (
                <button
                  onClick={() => {
                    setIsEditingCategory(true);
                    setCategoryInputValue('');
                  }}
                  className="btn btn-ghost btn-xs bg-white text-black hover:bg-gray-100 border border-black"
                  title="Add category"
                >
                  <PencilIcon className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
          
          {/* Editing input field and buttons below category line */}
          {isEditingCategory && (
            <div className="mt-3 flex flex-col gap-2">
              <div className="relative category-dropdown-container">
                <input
                  type="text"
                  value={categoryInputValue}
                  onChange={(e) => {
                    setCategoryInputValue(e.target.value);
                    setShowCategoryDropdown(true);
                  }}
                  onFocus={() => setShowCategoryDropdown(true)}
                  className="text-sm text-black bg-white border border-black rounded px-2 py-1 w-full"
                  placeholder="Type category name..."
                  disabled={isLoadingCategories}
                />
                {showCategoryDropdown && (
                  <div className="absolute top-full left-0 right-0 bg-white border border-black rounded shadow-lg z-10 max-h-40 overflow-y-auto">
                    {filteredCategories.slice(0, 10).map((category) => {
                      const categoryName = category.misc_maincategory?.name 
                        ? `${category.name} (${category.misc_maincategory.name})`
                        : category.name;
                      return (
                        <div
                          key={category.id}
                          onClick={() => {
                            setCategoryInputValue(categoryName);
                            setShowCategoryDropdown(false);
                          }}
                          className="px-2 py-1 text-sm text-black hover:bg-gray-100 cursor-pointer"
                        >
                          {categoryName}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleSaveCategory}
                  disabled={!categoryInputValue.trim() || isLoadingCategories}
                  className="btn btn-sm bg-black text-white hover:bg-gray-800 border-black"
                >
                  Save
                </button>
                <button
                  onClick={() => {
                    setIsEditingCategory(false);
                    setShowCategoryDropdown(false);
                    setCategoryInputValue('');
                  }}
                  className="btn btn-sm bg-white text-black hover:bg-gray-100 border border-black"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Topic */}
        <div className="flex justify-between items-center pb-2 border-b border-gray-200 last:border-b-0">
          <p className="text-sm font-medium uppercase tracking-wide bg-gradient-to-r from-purple-500 to-purple-600 text-transparent bg-clip-text">Topic</p>
          <p className="text-sm text-gray-900 text-right">
            {selectedClient ? (selectedClient.topic || 'German Citizenship') : 'German Citizenship'}
          </p>
        </div>
      </div>

      {/* Separation line for mobile view */}
      <div className="md:hidden border-t-2 border-gray-300 my-4"></div>

      {/* Progress & Follow-up - Mobile view inline */}
      <div className="space-y-3 md:hidden">
        {/* Probability */}
        <div className="pb-2 border-b border-gray-200 last:border-b-0">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium uppercase tracking-wide bg-gradient-to-r from-purple-500 to-purple-600 text-transparent bg-clip-text">Probability</p>
            <span className="text-sm font-semibold text-gray-900">{selectedClient?.probability || 0}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div 
              className="bg-[#3b28c7] h-2 rounded-full transition-all duration-300" 
              style={{ width: `${selectedClient?.probability || 0}%` }}
            ></div>
          </div>
        </div>

        {/* Next Follow-up */}
        <div className="flex justify-between items-center pb-2 border-b border-gray-200 last:border-b-0">
          <p className="text-sm font-medium uppercase tracking-wide bg-gradient-to-r from-purple-500 to-purple-600 text-transparent bg-clip-text">Next Follow-up</p>
          <p className="text-sm text-gray-900 text-right">
            {selectedClient?.next_followup ? (
              new Date(selectedClient.next_followup).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
              })
            ) : (
              'Not scheduled'
            )}
          </p>
        </div>

        {/* Closer */}
        <div className="flex justify-between items-center pb-2 border-b border-gray-200 last:border-b-0">
          <p className="text-sm font-medium uppercase tracking-wide bg-gradient-to-r from-purple-500 to-purple-600 text-transparent bg-clip-text">Closer</p>
          <p className="text-sm text-gray-900 text-right">
            {getEmployeeDisplayName ? getEmployeeDisplayName(selectedClient?.closer) : (selectedClient?.closer || 'Not assigned')}
          </p>
        </div>
      </div>
    </div>
  );
};

export default ClientInformationBox;
