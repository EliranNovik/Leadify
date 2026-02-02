import React, { useState, useEffect } from 'react';
import { UserIcon, PencilIcon, ArrowRightIcon } from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

interface ClientInformationBoxProps {
  selectedClient: any;
  getEmployeeDisplayName?: (employeeId: string | null | undefined) => string;
  onClientUpdate?: () => Promise<void>;
  isSubLead?: boolean;
  masterLeadNumber?: string | null;
  isMasterLeadProp?: boolean;
  subLeadsCountProp?: number;
}

const ClientInformationBox: React.FC<ClientInformationBoxProps> = ({ selectedClient, getEmployeeDisplayName, onClientUpdate, isSubLead, masterLeadNumber, isMasterLeadProp, subLeadsCountProp }) => {
  const navigate = useNavigate();
  const [legacyContactInfo, setLegacyContactInfo] = useState<{ email: string | null, phone: string | null }>({
    email: null,
    phone: null
  });
  const [isEditingCategory, setIsEditingCategory] = useState(false);
  const [allCategories, setAllCategories] = useState<any[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [isLoadingCategories, setIsLoadingCategories] = useState(false);
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const [categoryInputValue, setCategoryInputValue] = useState<string>('');
  const [allSources, setAllSources] = useState<Array<{ id: number | string, name: string }>>([]);
  const [isMasterLead, setIsMasterLead] = useState(false);
  const [subLeadsCount, setSubLeadsCount] = useState(0);

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

  // Fetch sources from misc_leadsource table
  useEffect(() => {
    const fetchSources = async () => {
      try {
        const { data, error } = await supabase
          .from('misc_leadsource')
          .select('id, name')
          .eq('active', true)
          .order('order', { ascending: true, nullsFirst: false });

        if (error) throw error;
        setAllSources(data || []);
      } catch (error) {
        console.error('Error fetching sources:', error);
      }
    };

    fetchSources();
  }, []);

  // Check if current lead is a master lead (has sub-leads)
  useEffect(() => {
    const checkIfMasterLead = async () => {
      if (!selectedClient) {
        setIsMasterLead(false);
        setSubLeadsCount(0);
        return;
      }

      try {
        const isLegacyLead = selectedClient?.lead_type === 'legacy' || selectedClient?.id?.toString().startsWith('legacy_');
        const clientId = isLegacyLead
          ? selectedClient.id.toString().replace('legacy_', '')
          : selectedClient.id?.toString();

        // Check for persisted subleads count first
        if (clientId) {
          try {
            const persistedSubLeadsKey = `clientsPage_subLeadsCount_${clientId}`;
            const persistedSubLeadsData = sessionStorage.getItem(persistedSubLeadsKey);
            if (persistedSubLeadsData) {
              const parsedData = JSON.parse(persistedSubLeadsData);
              console.log('🔍 ClientInformationBox: Using persisted subleads count, skipping fetch');
              setIsMasterLead(parsedData.count > 0);
              setSubLeadsCount(parsedData.count);
              return; // Skip fetch - use persisted data
            }
          } catch (error) {
            console.error('Error reading persisted subleads count:', error);
            // Continue to fetch if persisted data read fails
          }
        }

        let count = 0;

        if (isLegacyLead) {
          // For legacy leads, check leads_lead table
          const legacyId = selectedClient.id.toString().replace('legacy_', '');
          const { count: actualCount } = await supabase
            .from('leads_lead')
            .select('id', { count: 'exact', head: true })
            .eq('master_id', parseInt(legacyId, 10));

          count = actualCount || 0;
        } else {
          // For new leads, check leads table
          const { count: actualCount } = await supabase
            .from('leads')
            .select('id', { count: 'exact', head: true })
            .eq('master_id', selectedClient.id);

          count = actualCount || 0;
        }

        setIsMasterLead(count > 0);
        setSubLeadsCount(count);

        // Persist subleads count to sessionStorage
        if (clientId) {
          try {
            const persistedSubLeadsKey = `clientsPage_subLeadsCount_${clientId}`;
            sessionStorage.setItem(persistedSubLeadsKey, JSON.stringify({ count, isMaster: count > 0 }));
          } catch (error) {
            console.error('Error persisting subleads count:', error);
          }
        }
      } catch (error) {
        console.error('Error checking if master lead:', error);
        setIsMasterLead(false);
        setSubLeadsCount(0);
      }
    };

    checkIfMasterLead();
  }, [selectedClient?.id, selectedClient?.lead_type]);

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

  // Helper function to get source display name from misc_leadsource
  const getSourceDisplayName = (sourceId: string | number | null | undefined, fallbackSource?: string) => {
    if (!sourceId || sourceId === '---' || sourceId === '' || sourceId === null || sourceId === undefined) {
      return fallbackSource || '';
    }

    // Convert sourceId to string/number for comparison (handle bigint)
    const sourceIdStr = String(sourceId).trim();
    if (sourceIdStr === '' || sourceIdStr === 'null' || sourceIdStr === 'undefined') {
      return fallbackSource || '';
    }

    // Find source in loaded sources - compare as numbers or strings
    const source = allSources.find((src: any) => {
      const srcId = String(src.id).trim();
      const searchId = sourceIdStr;
      return srcId === searchId || Number(srcId) === Number(searchId);
    });

    if (source) {
      return source.name;
    }

    // Fallback to the source name if source_id not found
    return fallbackSource || '';
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

        // Check for persisted contact data first (same pattern as Clients.tsx)
        try {
          const persistedContactKey = `clientsPage_contactData_${legacyId}`;
          const persistedContactData = sessionStorage.getItem(persistedContactKey);
          if (persistedContactData) {
            const parsedContactData = JSON.parse(persistedContactData);
            console.log('🔍 ClientInformationBox: Using persisted contact data, skipping fetch');
            setLegacyContactInfo(parsedContactData);
            return; // Skip fetch - use persisted data
          }
        } catch (error) {
          console.error('Error reading persisted contact data:', error);
          // Continue to fetch if persisted data read fails
        }

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
              const contactInfo = {
                email: contactData.email,
                phone: contactData.phone
              };
              setLegacyContactInfo(contactInfo);
              // Persist contact data to sessionStorage
              try {
                const persistedContactKey = `clientsPage_contactData_${legacyId}`;
                sessionStorage.setItem(persistedContactKey, JSON.stringify(contactInfo));
              } catch (error) {
                console.error('Error persisting contact data:', error);
              }
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
                const contactInfo = {
                  email: contactData.email,
                  phone: contactData.phone
                };
                setLegacyContactInfo(contactInfo);
                // Persist contact data to sessionStorage
                try {
                  const persistedContactKey = `clientsPage_contactData_${legacyId}`;
                  sessionStorage.setItem(persistedContactKey, JSON.stringify(contactInfo));
                } catch (error) {
                  console.error('Error persisting contact data:', error);
                }
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
                const contactInfo = {
                  email: legacyData.email,
                  phone: legacyData.phone
                };
                setLegacyContactInfo(contactInfo);
                // Persist contact data to sessionStorage
                try {
                  const persistedContactKey = `clientsPage_contactData_${legacyId}`;
                  sessionStorage.setItem(persistedContactKey, JSON.stringify(contactInfo));
                } catch (error) {
                  console.error('Error persisting contact data:', error);
                }
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
    <div>
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: '#391BC8' }}>
          <UserIcon className="w-5 h-5 text-white" />
        </div>
        <div className="flex flex-col flex-1">
          {/* Master Lead Indicator */}
          {isMasterLead && selectedClient && (
            <div className="mb-2">
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const isLegacyLead = selectedClient?.lead_type === 'legacy' || selectedClient?.id?.toString().startsWith('legacy_');
                  const leadId = isLegacyLead
                    ? selectedClient.id.toString().replace('legacy_', '')
                    : selectedClient.id;
                  const leadNumber = selectedClient.lead_number || selectedClient.manual_id || leadId;
                  navigate(`/clients/${encodeURIComponent(leadNumber)}/master`);
                }}
                className="text-xs font-semibold text-purple-600 hover:text-purple-700 hover:underline transition-colors cursor-pointer"
                title={`View all ${subLeadsCount} sub-lead${subLeadsCount !== 1 ? 's' : ''}`}
              >
                Master lead ({subLeadsCount} sub-lead{subLeadsCount !== 1 ? 's' : ''})
              </button>
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold text-gray-900">
              {selectedClient ? (() => {
                // Prefer the formatted lead number (e.g. "L18/2"), fall back to manual_id and finally to id
                let displayNumber = selectedClient.lead_number || selectedClient.manual_id || selectedClient.id || '---';

                // Check if it has an existing suffix (for subleads)
                const displayStr = displayNumber.toString();
                const hasExistingSuffix = displayStr.includes('/');
                let baseNumber = hasExistingSuffix ? displayStr.split('/')[0] : displayStr;
                const existingSuffix = hasExistingSuffix ? displayStr.split('/').slice(1).join('/') : null;

                // Show "C" prefix in UI for both new and legacy leads when stage is Success (100)
                const isSuccessStage = selectedClient.stage === '100' || selectedClient.stage === 100;
                if (isSuccessStage && baseNumber && !baseNumber.toString().startsWith('C')) {
                  // Replace "L" prefix with "C" for display only
                  baseNumber = baseNumber.toString().replace(/^L/, 'C');
                }

                // Add /1 suffix to master leads (frontend only)
                // A lead is a master if: it has no master_id AND it has subleads
                const hasNoMasterId = !selectedClient.master_id || String(selectedClient.master_id).trim() === '';
                const isMasterWithSubLeads = hasNoMasterId && (isMasterLead || isMasterLeadProp);

                if (isMasterWithSubLeads && !hasExistingSuffix) {
                  // Master lead with subleads - add /1
                  displayNumber = `${baseNumber}/1`;
                } else if (hasExistingSuffix) {
                  // Sublead - preserve the existing suffix
                  displayNumber = `${baseNumber}/${existingSuffix}`;
                } else {
                  // Regular lead without suffix
                  displayNumber = baseNumber;
                }

                return displayNumber;
              })() : '---'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold text-gray-700 max-w-[200px]" style={{ fontSize: 'clamp(0.875rem, 2vw, 1.125rem)' }}>
              {selectedClient ? (selectedClient.name || '---') : '---'}
            </span>
            {(() => {
              const hasLanguage = selectedClient?.language;
              console.log('🔍 ClientInformationBox - Language badge check:', {
                hasLanguage,
                language: selectedClient?.language,
                languageId: selectedClient?.language_id,
                selectedClientId: selectedClient?.id
              });
              return hasLanguage ? (
                <span className="px-3 py-1 text-sm font-semibold text-white bg-gradient-to-r from-pink-500 via-purple-500 to-purple-600 rounded-full">
                  {selectedClient.language}
                </span>
              ) : null;
            })()}
            {/* Master Lead button - next to language badge for sub-leads */}
            {(() => {
              if (!isSubLead) return null;

              const isLegacyLead = selectedClient?.lead_type === 'legacy' || selectedClient?.id?.toString().startsWith('legacy_');

              // For legacy leads: require masterLeadNumber
              // For new leads: show button if master_id exists (masterLeadNumber will be fetched async by Clients.tsx)
              if (isLegacyLead) {
                // Legacy leads: need masterLeadNumber from lead_number pattern or fetched
                if (!masterLeadNumber) return null;
                return (
                  <a
                    href={`/clients/${masterLeadNumber}/master`}
                    className="px-3 py-1 text-sm font-semibold text-white bg-gradient-to-r from-purple-600 to-blue-600 rounded-full flex items-center gap-1.5 flex-shrink-0 w-fit hover:from-purple-700 hover:to-blue-700 transition-all"
                  >
                    <ArrowRightIcon className="w-4 h-4" />
                    Master Lead
                  </a>
                );
              } else {
                // New leads: show button if master_id exists
                // The masterLeadNumber will be fetched async, so show button even if it's not yet available
                if (!selectedClient?.master_id) return null;

                // If masterLeadNumber is available, use it for the link
                // Otherwise, the button will appear but the link will be set once masterLeadNumber is fetched
                const handleClick = async (e: React.MouseEvent) => {
                  if (!masterLeadNumber && selectedClient?.master_id) {
                    // If masterLeadNumber is not yet available, fetch it on click
                    e.preventDefault();
                    try {
                      const masterId = selectedClient.master_id;
                      console.log('🔍 Click handler - Fetching master lead number:', {
                        masterId,
                        masterIdType: typeof masterId
                      });

                      // Check if master_id is UUID or numeric
                      const isUUID = typeof masterId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(masterId);

                      let leadNumber: string | null = null;

                      if (isUUID) {
                        // Query leads table with UUID
                        const { data, error } = await supabase
                          .from('leads')
                          .select('lead_number')
                          .eq('id', masterId)
                          .maybeSingle();

                        if (error) {
                          console.error('Error fetching master lead number from leads table:', error);
                          throw error;
                        }
                        leadNumber = data?.lead_number || null;
                        console.log('🔍 Click handler - Result from leads table:', { leadNumber });
                      } else {
                        // master_id is numeric, so it's a legacy lead ID
                        // Query leads_lead table and use the ID as lead_number
                        const numericId = parseInt(String(masterId), 10);
                        if (!isNaN(numericId)) {
                          try {
                            const { data: legacyData, error: legacyError } = await supabase
                              .from('leads_lead')
                              .select('id')
                              .eq('id', numericId)
                              .single();

                            if (legacyError) {
                              console.error('Error fetching master lead number from leads_lead table:', legacyError);
                              // If not found, still try to navigate using the numeric ID as lead_number
                              // For legacy leads, the lead_number is often just the ID
                              console.log('🔍 Master lead not found in leads_lead, using master_id as lead_number:', numericId);
                              leadNumber = String(numericId);
                            } else if (legacyData?.id) {
                              // Found in leads_lead table - use the numeric ID as lead_number
                              leadNumber = String(legacyData.id);
                              console.log('🔍 Click handler - Found in leads_lead table:', { leadNumber });
                            }
                          } catch (err) {
                            // If query fails, still use the numeric ID as lead_number for navigation
                            console.log('🔍 Error querying leads_lead, using master_id as lead_number:', numericId);
                            leadNumber = String(numericId);
                          }
                        } else {
                          // master_id is not a valid numeric ID
                          console.error('Invalid master_id format:', masterId);
                          toast.error('Invalid master lead ID');
                          return;
                        }
                      }

                      if (leadNumber) {
                        // For legacy leads (numeric IDs), add "L" prefix
                        const isLegacyMaster = !isUUID && !isNaN(parseInt(String(masterId), 10));
                        const navigationPath = isLegacyMaster ? `/clients/L${leadNumber}/master` : `/clients/${leadNumber}/master`;
                        navigate(navigationPath);
                      } else {
                        console.error('Master lead number is null after all attempts');
                        toast.error('Master lead not found');
                      }
                    } catch (error) {
                      console.error('Error fetching master lead number on click:', error);
                      toast.error('Failed to load master lead');
                    }
                  }
                };

                // Determine if master is legacy (numeric) to add "L" prefix
                const isLegacyMaster = masterLeadNumber && /^\d+$/.test(String(masterLeadNumber));
                const masterHref = masterLeadNumber
                  ? (isLegacyMaster ? `/clients/L${masterLeadNumber}/master` : `/clients/${masterLeadNumber}/master`)
                  : '#';

                return (
                  <a
                    href={masterHref}
                    onClick={handleClick}
                    className="px-3 py-1 text-sm font-semibold text-white bg-gradient-to-r from-purple-600 to-blue-600 rounded-full flex items-center gap-1.5 flex-shrink-0 w-fit hover:from-purple-700 hover:to-blue-700 transition-all"
                  >
                    <ArrowRightIcon className="w-4 h-4" />
                    Master Lead
                  </a>
                );
              }
            })()}
            {/* View Sub-Leads button - next to language badge for master leads */}
            {(() => {
              const shouldShow = isMasterLeadProp && subLeadsCountProp && subLeadsCountProp > 0 && !(selectedClient?.master_id && String(selectedClient.master_id).trim() !== '');
              console.log('🔍 ClientInformationBox - Master lead button check:', {
                isMasterLeadProp,
                subLeadsCountProp,
                hasMasterId: !!(selectedClient?.master_id && String(selectedClient.master_id).trim() !== ''),
                shouldShow,
                selectedClientId: selectedClient?.id
              });
              return shouldShow ? (
                <a
                  href={`/clients/${(() => {
                    // Get the base lead number without any suffix like /2
                    const leadNumber = selectedClient?.lead_number || selectedClient?.id || '';
                    return leadNumber.toString().split('/')[0];
                  })()}/master`}
                  className="px-3 py-1 text-sm font-semibold text-white bg-gradient-to-r from-purple-600 to-blue-600 rounded-full flex items-center gap-1.5 flex-shrink-0 w-fit hover:from-purple-700 hover:to-blue-700 transition-all"
                >
                  <ArrowRightIcon className="w-4 h-4" />
                  View Sub-Leads ({subLeadsCountProp})
                </a>
              ) : null;
            })()}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {/* Email */}
        <div className="flex items-center gap-4 md:gap-6 pb-2 border-b border-gray-200 last:border-b-0">
          <p className="text-sm font-medium uppercase tracking-wide bg-gradient-to-r from-purple-500 to-purple-600 text-transparent bg-clip-text flex-shrink-0">Email</p>
          <a href={displayEmail ? `mailto:${displayEmail}` : undefined} className="text-sm text-gray-900 break-all">
            {displayEmail || '---'}
          </a>
        </div>

        {/* Phone */}
        <div className="flex items-center gap-4 md:gap-6 pb-2 border-b border-gray-200 last:border-b-0">
          <p className="text-sm font-medium uppercase tracking-wide bg-gradient-to-r from-purple-500 to-purple-600 text-transparent bg-clip-text flex-shrink-0">Phone</p>
          <a href={displayPhone ? `tel:${displayPhone}` : undefined} className="text-sm text-gray-900">
            {displayPhone || '---'}
          </a>
        </div>

        {/* Category */}
        <div className="pb-2 border-b border-gray-200 last:border-b-0">
          <div className="flex items-center gap-4 md:gap-6">
            <p className="text-sm font-medium uppercase tracking-wide bg-gradient-to-r from-purple-500 to-purple-600 text-transparent bg-clip-text flex-shrink-0">Category</p>
            <div className="flex items-center gap-2">
              <p className="text-sm text-black">
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
        <div className="flex items-center gap-4 md:gap-6 pb-2 border-b border-gray-200 last:border-b-0">
          <p className="text-sm font-medium uppercase tracking-wide bg-gradient-to-r from-purple-500 to-purple-600 text-transparent bg-clip-text flex-shrink-0">Topic</p>
          <p className="text-sm text-gray-900">
            {selectedClient ? (selectedClient.topic || 'German Citizenship') : 'German Citizenship'}
          </p>
        </div>

        {/* Source */}
        <div className="flex items-center gap-4 md:gap-6 pb-2 border-b border-gray-200 last:border-b-0">
          <p className="text-sm font-medium uppercase tracking-wide bg-gradient-to-r from-purple-500 to-purple-600 text-transparent bg-clip-text flex-shrink-0">Source</p>
          <p className="text-sm text-gray-900">
            {selectedClient ? (() => {
              // Prioritize source_id (foreign key to misc_leadsource), fallback to source field
              const sourceId = selectedClient.source_id ?? selectedClient.source;
              return getSourceDisplayName(sourceId, selectedClient.source) || '---';
            })() : '---'}
          </p>
        </div>
      </div>

      {/* Separation line for mobile view */}
      <div className="md:hidden border-t-2 border-gray-300 my-4"></div>

      {/* Progress & Follow-up - Mobile view inline */}
      <div className="space-y-3 md:hidden">
        {/* Probability */}
        <div className="pb-2">
          <div className="flex items-center gap-4 md:gap-6 mb-2">
            <p className="text-sm font-medium uppercase tracking-wide bg-gradient-to-r from-purple-500 to-purple-600 text-transparent bg-clip-text flex-shrink-0">Probability</p>
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
        <div className="flex items-center gap-4 md:gap-6 pb-2">
          <p className="text-sm font-medium uppercase tracking-wide bg-gradient-to-r from-purple-500 to-purple-600 text-transparent bg-clip-text flex-shrink-0">Next Follow-up</p>
          <p className="text-sm text-gray-900">
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

        {/* Closer (if assigned) */}
        {selectedClient?.closer &&
          selectedClient?.closer !== '---' &&
          selectedClient?.closer !== null &&
          selectedClient?.closer !== undefined &&
          (getEmployeeDisplayName ? getEmployeeDisplayName(selectedClient?.closer) !== 'Not assigned' : selectedClient?.closer !== 'Not assigned') ? (
          <div className="flex items-center gap-4 md:gap-6 pb-2">
            <p className="text-sm font-medium uppercase tracking-wide bg-gradient-to-r from-purple-500 to-purple-600 text-transparent bg-clip-text flex-shrink-0">Closer</p>
            <p className="text-sm text-gray-900">
              {getEmployeeDisplayName ? getEmployeeDisplayName(selectedClient?.closer) : selectedClient?.closer}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default ClientInformationBox;
