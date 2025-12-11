import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useMsal } from '@azure/msal-react';

interface NewLeadResult {
  id: string; // This will be a UUID string
  lead_number: string;
  name: string;
  email: string;
}

const CreateNewLead: React.FC = () => {
  const navigate = useNavigate();
  const { instance } = useMsal();
  const [isLoading, setIsLoading] = useState(false);
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    source: '',
    language: '',
    category: '',
    country_id: '',
    topic: '',
    facts: '',
    specialNotes: '',
    balance_currency: 'NIS',
    proposal_currency: 'NIS',
  });
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const [sourceOptions, setSourceOptions] = useState<Array<{ id: number; name: string }>>([]);
  const [languageOptions, setLanguageOptions] = useState<Array<{ id: number; name: string | null }>>([]);
  const [categoryOptions, setCategoryOptions] = useState<Array<{ id: number; name: string; displayName: string }>>([]);
  const [countryOptions, setCountryOptions] = useState<Array<{ id: number; name: string; phone_code: string; iso_code: string }>>([]);
  const [countryDropdownOptions, setCountryDropdownOptions] = useState<Array<{ id: number; name: string; iso_code: string }>>([]);
  const [selectedCountryCode, setSelectedCountryCode] = useState<string>('+972'); // Default to Israel
  const [sourceSearchTerm, setSourceSearchTerm] = useState<string>('');
  const [showSourceDropdown, setShowSourceDropdown] = useState<boolean>(false);
  const sourceInputRef = useRef<HTMLDivElement>(null);
  const [categorySearchTerm, setCategorySearchTerm] = useState<string>('');
  const [showCategoryDropdown, setShowCategoryDropdown] = useState<boolean>(false);
  const categoryInputRef = useRef<HTMLDivElement>(null);
  const [countrySearchTerm, setCountrySearchTerm] = useState<string>('');
  const [showCountryDropdown, setShowCountryDropdown] = useState<boolean>(false);
  const countryInputRef = useRef<HTMLDivElement>(null);
  const [countryCodeSearchTerm, setCountryCodeSearchTerm] = useState<string>(''); // Empty initially, will show placeholder
  const [showCountryCodeDropdown, setShowCountryCodeDropdown] = useState<boolean>(false);
  const countryCodeInputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchUser = async () => {
      // Get current user from MSAL
      const account = instance?.getAllAccounts()[0];
      if (account?.username) {
        setCurrentUserEmail(account.username);
      } else {
        // Fallback to Supabase auth if MSAL is not available
        const { data: { user } } = await supabase.auth.getUser();
        setCurrentUserEmail(user?.email || null);
      }
    };
    fetchUser();
  }, [instance]);

  useEffect(() => {
    const fetchSourcesAndLanguages = async () => {
      try {
        const [
          { data: sourcesData, error: sourcesError },
          { data: languagesData, error: languagesError },
          { data: categoriesData, error: categoriesError },
          { data: countriesData, error: countriesError },
          { data: allCountriesData, error: allCountriesError }
        ] = await Promise.all([
          supabase
            .from('misc_leadsource')
            .select('id, name')
            .eq('active', true)
            .order('order', { ascending: true }),
          supabase
            .from('misc_language')
            .select('id, name')
            .order('name', { ascending: true }),
          supabase
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
            .order('name', { ascending: true }),
          supabase
            .from('misc_country')
            .select('id, name, phone_code, iso_code')
            .not('phone_code', 'is', null)
            .order('"order"', { ascending: true })
            .order('name', { ascending: true }),
          supabase
            .from('misc_country')
            .select('id, name, iso_code')
            .order('"order"', { ascending: true })
            .order('name', { ascending: true }),
        ]);

        if (!sourcesError && sourcesData) {
          setSourceOptions(
            sourcesData
              .filter(source => source?.name)
              .map(source => ({ id: source.id, name: source.name }))
          );
        }

        if (!languagesError && languagesData) {
          setLanguageOptions(
            languagesData
              .filter(language => language?.name)
              .map(language => ({ id: language.id, name: language.name }))
          );
        }

        if (!categoriesError && categoriesData) {
          const formattedCategories = categoriesData
            .filter(category => category?.name)
            .map((category: any) => {
              const mainCategory = Array.isArray(category.misc_maincategory) 
                ? category.misc_maincategory[0] 
                : category.misc_maincategory;
              const displayName = mainCategory?.name 
                ? `${category.name} (${mainCategory.name})`
                : category.name;
              return {
                id: category.id,
                name: category.name,
                displayName: displayName
              };
            });
          setCategoryOptions(formattedCategories);
        }

        if (!countriesError && countriesData) {
          // Process countries: normalize phone codes, filter out NULL phone_code
          // Keep ALL countries even if they share the same phone code
          const processedCountries = countriesData
            .filter(country => country?.phone_code && country?.phone_code !== '\\N' && country?.phone_code !== null && country?.name)
            .map(country => ({
              id: country.id,
              name: country.name,
              phone_code: country.phone_code.startsWith('+') ? country.phone_code : `+${country.phone_code}`,
              iso_code: country.iso_code || ''
            }));

          // Sort all countries (including duplicates by phone code)
          const sortedCountries = processedCountries.sort((a, b) => {
            // Sort ID 110 first (highest priority)
            if (a.id === 110 && b.id !== 110) return -1;
            if (b.id === 110 && a.id !== 110) return 1;
            // Sort ID 234 second
            if (a.id === 234 && b.id !== 234 && b.id !== 110) return -1;
            if (b.id === 234 && a.id !== 234 && a.id !== 110) return 1;
            // Sort ID 249 third
            if (a.id === 249 && b.id !== 249 && b.id !== 234 && b.id !== 110) return -1;
            if (b.id === 249 && a.id !== 249 && a.id !== 234 && a.id !== 110) return 1;
            // Then sort by phone code first
            const phoneCodeCompare = a.phone_code.localeCompare(b.phone_code);
            if (phoneCodeCompare !== 0) return phoneCodeCompare;
            // If phone codes are the same, sort by country name
            return a.name.localeCompare(b.name);
          });

          setCountryOptions(sortedCountries);
        }

        if (!allCountriesError && allCountriesData) {
          const processedCountries = allCountriesData
            .filter(country => country?.name)
            .map(country => ({
              id: country.id,
              name: country.name,
              iso_code: country.iso_code || ''
            }));

          // Ensure United States is included - check if it exists
          const hasUnitedStates = processedCountries.some(
            c => c.name.toLowerCase().includes('united states') || 
                 c.name.toLowerCase() === 'usa' || 
                 c.name.toLowerCase() === 'us' ||
                 c.iso_code === 'US' ||
                 c.iso_code === 'USA'
          );

          // If United States doesn't exist, try to find it by checking all countries (including those with null phone_code)
          if (!hasUnitedStates) {
            // Try to find USA in the countriesData (which includes phone_code filter)
            const usaFromPhoneCode = countriesData?.find(
              c => c.name.toLowerCase().includes('united states') || 
                   c.name.toLowerCase() === 'usa' || 
                   c.name.toLowerCase() === 'us' ||
                   c.iso_code === 'US' ||
                   c.iso_code === 'USA'
            );
            
            if (usaFromPhoneCode) {
              processedCountries.push({
                id: usaFromPhoneCode.id,
                name: usaFromPhoneCode.name,
                iso_code: usaFromPhoneCode.iso_code || 'US'
              });
            }
          }

          setCountryDropdownOptions(
            processedCountries.sort((a, b) => a.name.localeCompare(b.name))
          );
        }
      } catch (fetchError) {
        console.error('Error fetching source/language/country options:', fetchError);
      }
    };

    fetchSourcesAndLanguages();
  }, []);

  // Sync country code search term with selected code when dropdown closes
  useEffect(() => {
    if (!showCountryCodeDropdown && selectedCountryCode) {
      // Only sync if search term is empty or matches selected code
      if (!countryCodeSearchTerm || countryCodeSearchTerm === selectedCountryCode) {
        setCountryCodeSearchTerm('');
      }
    }
  }, [selectedCountryCode, showCountryCodeDropdown]);

  // Auto-select source if search term exactly matches an option
  useEffect(() => {
    const exactMatch = sourceOptions.find(
      source => source.name.toLowerCase() === sourceSearchTerm.toLowerCase()
    );
    if (exactMatch) {
      setForm(prev => ({ ...prev, source: exactMatch.name }));
    } else if (sourceSearchTerm && !exactMatch) {
      // Clear form.source if search term doesn't match exactly
      setForm(prev => ({ ...prev, source: '' }));
    }
  }, [sourceSearchTerm, sourceOptions]);

  // Auto-select category if search term exactly matches an option
  useEffect(() => {
    const exactMatch = categoryOptions.find(
      category => category.displayName.toLowerCase() === categorySearchTerm.toLowerCase() ||
                  category.name.toLowerCase() === categorySearchTerm.toLowerCase()
    );
    if (exactMatch) {
      setForm(prev => ({ ...prev, category: exactMatch.displayName }));
    } else if (categorySearchTerm && !exactMatch) {
      // Clear form.category if search term doesn't match exactly
      setForm(prev => ({ ...prev, category: '' }));
    }
  }, [categorySearchTerm, categoryOptions]);

  // Auto-select country if search term exactly matches an option
  useEffect(() => {
    const searchTerm = countrySearchTerm.toLowerCase();
    
    // Find exact match by name
    let exactMatch = countryDropdownOptions.find(
      country => country.name.toLowerCase() === searchTerm
    );
    
    // If no exact match, check for United States aliases
    if (!exactMatch && (searchTerm === 'usa' || searchTerm === 'us' || searchTerm === 'america')) {
      exactMatch = countryDropdownOptions.find(
        country => {
          const countryName = country.name.toLowerCase();
          const isoCode = country.iso_code.toLowerCase();
          return countryName.includes('united states') || 
                 countryName === 'usa' || 
                 isoCode === 'us' || 
                 isoCode === 'usa';
        }
      );
    }
    
    if (exactMatch) {
      setForm(prev => ({ ...prev, country_id: exactMatch.id.toString() }));
    } else if (countrySearchTerm && !exactMatch) {
      // Clear form.country_id if search term doesn't match exactly
      setForm(prev => ({ ...prev, country_id: '' }));
    }
  }, [countrySearchTerm, countryDropdownOptions]);

  // Close source dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (sourceInputRef.current && !sourceInputRef.current.contains(event.target as Node)) {
        setShowSourceDropdown(false);
      }
      if (categoryInputRef.current && !categoryInputRef.current.contains(event.target as Node)) {
        setShowCategoryDropdown(false);
      }
      if (countryInputRef.current && !countryInputRef.current.contains(event.target as Node)) {
        setShowCountryDropdown(false);
      }
      if (countryCodeInputRef.current && !countryCodeInputRef.current.contains(event.target as Node)) {
        setShowCountryCodeDropdown(false);
        // Clear search term when closing (will show placeholder)
        setCountryCodeSearchTerm('');
      }
    };

    if (showSourceDropdown || showCategoryDropdown || showCountryDropdown || showCountryCodeDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showSourceDropdown, showCategoryDropdown, showCountryDropdown, showCountryCodeDropdown, selectedCountryCode]);

  // Filter source options based on search term
  const filteredSourceOptions = sourceOptions.filter(source =>
    source.name.toLowerCase().includes(sourceSearchTerm.toLowerCase())
  );

  // Filter category options based on search term
  const filteredCategoryOptions = categoryOptions.filter(category =>
    category.displayName.toLowerCase().includes(categorySearchTerm.toLowerCase()) ||
    category.name.toLowerCase().includes(categorySearchTerm.toLowerCase())
  );

  // Filter country options based on search term
  const filteredCountryOptions = countryDropdownOptions.filter(country => {
    const searchTerm = countrySearchTerm.toLowerCase();
    const countryName = country.name.toLowerCase();
    const isoCode = country.iso_code.toLowerCase();
    
    // Check if search term matches country name or ISO code
    if (countryName.includes(searchTerm) || isoCode.includes(searchTerm)) {
      return true;
    }
    
    // Special handling for United States aliases
    const isUnitedStates = countryName.includes('united states') || 
                          countryName === 'usa' || 
                          isoCode === 'us' || 
                          isoCode === 'usa';
    if (isUnitedStates) {
      return searchTerm === 'usa' || 
             searchTerm === 'us' || 
             searchTerm === 'america' || 
             searchTerm.includes('united states');
    }
    
    return false;
  });

  // Filter country code options based on search term (search by code or country name)
  const filteredCountryCodeOptions = countryOptions.filter(country => {
    const searchTerm = countryCodeSearchTerm.toLowerCase();
    const phoneCode = country.phone_code.toLowerCase();
    const countryName = country.name.toLowerCase();
    
    // Direct matches
    if (phoneCode.includes(searchTerm) || countryName.includes(searchTerm)) {
      return true;
    }
    
    // Special handling for USA/United States/America
    const usaSearchTerms = ['usa', 'us', 'america', 'united states'];
    const isUSASearch = usaSearchTerms.some(term => searchTerm.includes(term) || term.includes(searchTerm));
    
    if (isUSASearch) {
      return countryName.includes('united states') || 
             countryName.includes('america') ||
             countryName === 'usa' || 
             countryName === 'us' ||
             country.iso_code === 'US' ||
             country.iso_code === 'USA' ||
             phoneCode === '+1';
    }
    
    // Special handling for United Kingdom/UK
    const ukSearchTerms = ['uk', 'united kingdom', 'britain', 'british'];
    const isUKSearch = ukSearchTerms.some(term => searchTerm.includes(term) || term.includes(searchTerm));
    
    if (isUKSearch) {
      return countryName.includes('united kingdom') || 
             countryName === 'uk' ||
             country.iso_code === 'GB' ||
             country.iso_code === 'UK' ||
             phoneCode === '+44';
    }
    
    return false;
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSourceSelect = (sourceName: string) => {
    setForm({ ...form, source: sourceName });
    setSourceSearchTerm(sourceName);
    setShowSourceDropdown(false);
  };

  const handleCategorySelect = (categoryDisplayName: string) => {
    setForm({ ...form, category: categoryDisplayName });
    setCategorySearchTerm(categoryDisplayName);
    setShowCategoryDropdown(false);
  };

  const handleCountrySelect = (countryId: number, countryName: string) => {
    console.log('Country selected:', { countryId, countryName });
    setForm({ ...form, country_id: countryId.toString() });
    setCountrySearchTerm(countryName);
    setShowCountryDropdown(false);
  };

  // Handle country code selection and auto-select matching country
  const handleCountryCodeSelect = (selectedCountry: { id: number; name: string; phone_code: string; iso_code: string }) => {
    setSelectedCountryCode(selectedCountry.phone_code);
    setCountryCodeSearchTerm(selectedCountry.phone_code);
    setShowCountryCodeDropdown(false);
    
    // Auto-select the matching country in the country dropdown
    // First try to find by ID (exact match)
    const matchingCountry = countryDropdownOptions.find(
      country => country.id === selectedCountry.id
    );
    
    if (matchingCountry) {
      handleCountrySelect(matchingCountry.id, matchingCountry.name);
    } else {
      // If not found by ID, try to find by name (case-insensitive)
      const matchingByName = countryDropdownOptions.find(
        country => country.name.toLowerCase() === selectedCountry.name.toLowerCase()
      );
      
      if (matchingByName) {
        handleCountrySelect(matchingByName.id, matchingByName.name);
      } else {
        // If not found by name, try to find by ISO code
        const matchingByIso = countryDropdownOptions.find(
          country => country.iso_code && country.iso_code.toLowerCase() === selectedCountry.iso_code.toLowerCase()
        );
        
        if (matchingByIso) {
          handleCountrySelect(matchingByIso.id, matchingByIso.name);
        }
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      // Combine country code with phone number
      let fullPhoneNumber = form.phone;
      if (form.phone && selectedCountryCode && selectedCountryCode !== 'null' && selectedCountryCode !== 'NULL') {
        // Check if phone already starts with a country code
        const phoneStartsWithPlus = form.phone.trim().startsWith('+');
        
        if (phoneStartsWithPlus) {
          // Phone already has a country code, use it as is
          fullPhoneNumber = form.phone.trim();
        } else {
          // Remove any leading zeros or spaces, then add the selected country code
          const cleanedPhone = form.phone.trim().replace(/^0+/, '');
          // Ensure country code has + prefix
          const countryCodeWithPlus = selectedCountryCode.startsWith('+') ? selectedCountryCode : `+${selectedCountryCode}`;
          fullPhoneNumber = `${countryCodeWithPlus}${cleanedPhone}`;
        }
      } else if (form.phone) {
        // If no country code selected but phone provided, use phone as is
        fullPhoneNumber = form.phone.trim();
      }

      // Extract category name from display format (remove main category part if present)
      let categoryName = form.category;
      if (categoryName && categoryName.includes(' (')) {
        categoryName = categoryName.split(' (')[0];
      }

      // Call the new database function to create the lead
      const { data, error } = await supabase.rpc('create_new_lead_v3', {
        p_lead_name: form.name,
        p_lead_email: form.email,
        p_lead_phone: fullPhoneNumber,
        p_lead_topic: form.topic,
        p_lead_language: form.language,
        p_lead_source: form.source,
        p_created_by: currentUserEmail,
        p_balance_currency: form.balance_currency,
        p_proposal_currency: form.proposal_currency,
      });

      if (error) throw error;
      const newLead = data?.[0] as NewLeadResult;
      if (!newLead) throw new Error("Could not create lead.");

      // Update the lead with category, facts, special_notes, and country_id if provided
      const updateData: { category?: string; facts?: string; special_notes?: string; country_id?: number } = {};
      if (categoryName && categoryName.trim()) {
        updateData.category = categoryName.trim();
      }
      if (form.facts && form.facts.trim()) {
        updateData.facts = form.facts.trim();
      }
      if (form.specialNotes && form.specialNotes.trim()) {
        updateData.special_notes = form.specialNotes.trim();
      }
      // Add country_id to leads table update if provided
      if (form.country_id && form.country_id.trim() !== '') {
        const countryIdInt = parseInt(form.country_id, 10);
        if (!isNaN(countryIdInt)) {
          updateData.country_id = countryIdInt;
        }
      }

      if (Object.keys(updateData).length > 0) {
        const { error: updateError } = await supabase
          .from('leads')
          .update(updateData)
          .eq('id', newLead.id);

        if (updateError) {
          console.error('Error updating lead fields:', updateError);
          // Don't throw - lead was created successfully, just log the error
        } else {
          if (updateData.country_id) {
            console.log('Successfully updated leads table with country_id:', updateData.country_id);
          }
        }
      }

      // Also update the contact record with country_id if provided (for consistency)
      // Note: Contact might not exist immediately after lead creation, so we use maybeSingle()
      if (form.country_id && form.country_id.trim() !== '') {
        const countryIdInt = parseInt(form.country_id, 10);
        if (!isNaN(countryIdInt)) {
          // Try to find the contact record for this lead (use maybeSingle to handle no rows)
          const { data: contactData, error: contactFetchError } = await supabase
            .from('leads_contact')
            .select('id')
            .eq('newlead_id', newLead.id)
            .maybeSingle();

          if (contactFetchError) {
            console.error('Error fetching contact for country update:', contactFetchError);
          } else if (contactData && contactData.id) {
            // Contact exists, update it
            const { error: contactUpdateError } = await supabase
              .from('leads_contact')
              .update({ country_id: countryIdInt })
              .eq('id', contactData.id);

            if (contactUpdateError) {
              console.error('Error updating contact country_id:', contactUpdateError);
              // Don't throw - lead was created successfully, just log the error
            } else {
              console.log('Successfully updated contact country_id to:', countryIdInt);
            }
          } else {
            // Contact doesn't exist yet - this is fine, the country_id is already saved in leads table
            console.log('Contact not found yet for new lead (this is normal), country_id already saved in leads table');
          }
        }
      }

      // Navigate to the new lead's page
      navigate(`/clients/${newLead.lead_number}`);
    } catch (error) {
      console.error('Error creating lead:', error);
      alert('Failed to create lead. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-8">
      <h1 className="text-4xl font-bold mb-8">Create New Lead</h1>
      <form className="space-y-6" onSubmit={handleSubmit}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className="block font-semibold mb-1">Name:</label>
          <input
            type="text"
            name="name"
            className="input input-bordered w-full"
            value={form.name}
            onChange={handleChange}
            required
          />
        </div>
        <div>
          <label className="block font-semibold mb-1">Email:</label>
          <input
            type="email"
            name="email"
            className="input input-bordered w-full"
            value={form.email}
            onChange={handleChange}
          />
        </div>
        <div>
          <label className="block font-semibold mb-1">Phone:</label>
          <div className="flex gap-2">
            <div className="relative w-56" ref={countryCodeInputRef}>
              <input
                type="text"
                className="input input-bordered w-full"
                value={countryCodeSearchTerm}
                onChange={(e) => {
                  setCountryCodeSearchTerm(e.target.value);
                  setShowCountryCodeDropdown(true);
                }}
                onFocus={() => {
                  setShowCountryCodeDropdown(true);
                  // Clear the field on focus so user can type immediately
                  setCountryCodeSearchTerm('');
                }}
                placeholder={selectedCountryCode || '+972'}
              />
            {showCountryCodeDropdown && filteredCountryCodeOptions.length > 0 && (
              <div className="absolute z-50 w-full mt-1 bg-base-100 border border-base-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                {filteredCountryCodeOptions.map(country => (
                  <button
                    key={`${country.phone_code}-${country.id}`}
                    type="button"
                    className="w-full text-left px-4 py-2 hover:bg-base-200 transition-colors flex items-center gap-2"
                    onClick={() => handleCountryCodeSelect(country)}
                  >
                    <span className="font-semibold text-primary min-w-[60px]">{country.phone_code}</span>
                    <span className="text-base-content">{country.name}</span>
                  </button>
                ))}
              </div>
            )}
              {showCountryCodeDropdown && filteredCountryCodeOptions.length === 0 && countryCodeSearchTerm && (
                <div className="absolute z-50 w-full mt-1 bg-base-100 border border-base-300 rounded-lg shadow-lg p-4 text-center text-base-content/60">
                  No country codes found
                </div>
              )}
            </div>
            <input
              type="tel"
              name="phone"
              className="input input-bordered flex-1"
              value={form.phone}
              onChange={handleChange}
              placeholder="Phone number"
            />
          </div>
        </div>
        <div>
          <label className="block font-semibold mb-1">Source:</label>
          <div className="relative" ref={sourceInputRef}>
            <input
              type="text"
              className="input input-bordered w-full"
              value={sourceSearchTerm}
              onChange={(e) => {
                setSourceSearchTerm(e.target.value);
                setShowSourceDropdown(true);
                if (e.target.value !== form.source) {
                  setForm({ ...form, source: '' });
                }
              }}
              onFocus={() => setShowSourceDropdown(true)}
              placeholder="Search or type source..."
              required
            />
            {showSourceDropdown && filteredSourceOptions.length > 0 && (
              <div className="absolute z-50 w-full mt-1 bg-base-100 border border-base-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                {filteredSourceOptions.map(source => (
                  <button
                    key={source.id}
                    type="button"
                    className="w-full text-left px-4 py-2 hover:bg-base-200 transition-colors"
                    onClick={() => handleSourceSelect(source.name)}
                  >
                    {source.name}
                  </button>
                ))}
              </div>
            )}
            {showSourceDropdown && filteredSourceOptions.length === 0 && sourceSearchTerm && (
              <div className="absolute z-50 w-full mt-1 bg-base-100 border border-base-300 rounded-lg shadow-lg p-4 text-center text-base-content/60">
                No sources found
              </div>
            )}
          </div>
        </div>
        <div>
          <label className="block font-semibold mb-1">Language:</label>
          <select
            name="language"
            className="select select-bordered w-full"
            value={form.language}
            onChange={handleChange}
            required
          >
            <option value="">----------</option>
            {languageOptions.map(language => (
              <option key={language.id} value={language.name ?? ''}>{language.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block font-semibold mb-1">Country <span className="text-gray-500 font-normal">(optional)</span>:</label>
          <div className="relative" ref={countryInputRef}>
            <input
              type="text"
              className="input input-bordered w-full"
              value={countrySearchTerm}
              onChange={(e) => {
                setCountrySearchTerm(e.target.value);
                setShowCountryDropdown(true);
                if (e.target.value !== countryDropdownOptions.find(c => c.id.toString() === form.country_id)?.name) {
                  setForm({ ...form, country_id: '' });
                }
              }}
              onFocus={() => setShowCountryDropdown(true)}
              placeholder="Search or type country..."
            />
            {showCountryDropdown && filteredCountryOptions.length > 0 && (
              <div className="absolute z-50 w-full mt-1 bg-base-100 border border-base-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                {filteredCountryOptions.map(country => (
                  <button
                    key={country.id}
                    type="button"
                    className="w-full text-left px-4 py-2 hover:bg-base-200 transition-colors"
                    onClick={() => handleCountrySelect(country.id, country.name)}
                  >
                    {country.name}
                  </button>
                ))}
              </div>
            )}
            {showCountryDropdown && filteredCountryOptions.length === 0 && countrySearchTerm && (
              <div className="absolute z-50 w-full mt-1 bg-base-100 border border-base-300 rounded-lg shadow-lg p-4 text-center text-base-content/60">
                No countries found
              </div>
            )}
          </div>
        </div>
        <div>
          <label className="block font-semibold mb-1">Category:</label>
          <div className="relative" ref={categoryInputRef}>
            <input
              type="text"
              className="input input-bordered w-full"
              value={categorySearchTerm}
              onChange={(e) => {
                setCategorySearchTerm(e.target.value);
                setShowCategoryDropdown(true);
                if (e.target.value !== form.category) {
                  setForm({ ...form, category: '' });
                }
              }}
              onFocus={() => setShowCategoryDropdown(true)}
              placeholder="Search or type category..."
            />
            {showCategoryDropdown && filteredCategoryOptions.length > 0 && (
              <div className="absolute z-50 w-full mt-1 bg-base-100 border border-base-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                {filteredCategoryOptions.map(category => (
                  <button
                    key={category.id}
                    type="button"
                    className="w-full text-left px-4 py-2 hover:bg-base-200 transition-colors"
                    onClick={() => handleCategorySelect(category.displayName)}
                  >
                    {category.displayName}
                  </button>
                ))}
              </div>
            )}
            {showCategoryDropdown && filteredCategoryOptions.length === 0 && categorySearchTerm && (
              <div className="absolute z-50 w-full mt-1 bg-base-100 border border-base-300 rounded-lg shadow-lg p-4 text-center text-base-content/60">
                No categories found
              </div>
            )}
          </div>
        </div>
        <div>
          <label className="block font-semibold mb-1">Topic <span className="text-gray-500 font-normal">(optional)</span>:</label>
          <input
            type="text"
            name="topic"
            className="input input-bordered w-full"
            value={form.topic}
            onChange={handleChange}
          />
        </div>
        <div>
          <label className="block font-semibold mb-1">Facts of Case:</label>
          <textarea
            name="facts"
            className="textarea textarea-bordered w-full min-h-[120px]"
            value={form.facts}
            onChange={handleChange}
          />
        </div>
        <div>
          <label className="block font-semibold mb-1">Special notes:</label>
          <textarea
            name="specialNotes"
            className="textarea textarea-bordered w-full min-h-[80px]"
            value={form.specialNotes}
            onChange={handleChange}
          />
        </div>
        </div>
        <div className="pt-4 md:col-span-2">
          <button 
            type="submit" 
            className={`btn btn-primary w-full md:w-auto md:min-w-[200px] text-lg font-semibold ${isLoading ? 'loading' : ''}`}
            disabled={isLoading}
          >
            {isLoading ? 'Saving...' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default CreateNewLead; 