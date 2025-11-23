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
    topic: '',
    facts: '',
    specialNotes: '',
    balance_currency: 'NIS',
    proposal_currency: 'NIS',
  });
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const [sourceOptions, setSourceOptions] = useState<Array<{ id: number; name: string }>>([]);
  const [languageOptions, setLanguageOptions] = useState<Array<{ id: number; name: string | null }>>([]);
  const [countryOptions, setCountryOptions] = useState<Array<{ id: number; name: string; phone_code: string; iso_code: string }>>([]);
  const [selectedCountryCode, setSelectedCountryCode] = useState<string>('+972'); // Default to Israel
  const [sourceSearchTerm, setSourceSearchTerm] = useState<string>('');
  const [showSourceDropdown, setShowSourceDropdown] = useState<boolean>(false);
  const sourceInputRef = useRef<HTMLDivElement>(null);

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
          { data: countriesData, error: countriesError }
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
            .from('misc_country')
            .select('id, name, phone_code, iso_code')
            .not('phone_code', 'is', null)
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

        if (!countriesError && countriesData) {
          setCountryOptions(
            countriesData
              .filter(country => country?.phone_code && country?.name)
              .map(country => ({
                id: country.id,
                name: country.name,
                phone_code: country.phone_code.startsWith('+') ? country.phone_code : `+${country.phone_code}`,
                iso_code: country.iso_code || ''
              }))
          );
        }
      } catch (fetchError) {
        console.error('Error fetching source/language/country options:', fetchError);
      }
    };

    fetchSourcesAndLanguages();
  }, []);

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

  // Close source dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (sourceInputRef.current && !sourceInputRef.current.contains(event.target as Node)) {
        setShowSourceDropdown(false);
      }
    };

    if (showSourceDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showSourceDropdown]);

  // Filter source options based on search term
  const filteredSourceOptions = sourceOptions.filter(source =>
    source.name.toLowerCase().includes(sourceSearchTerm.toLowerCase())
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSourceSelect = (sourceName: string) => {
    setForm({ ...form, source: sourceName });
    setSourceSearchTerm(sourceName);
    setShowSourceDropdown(false);
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
    <div className="max-w-xl mx-auto p-8">
      <h1 className="text-4xl font-bold mb-8">Create New Lead</h1>
      <form className="space-y-6" onSubmit={handleSubmit}>
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
            <select
              className="select select-bordered w-40"
              value={selectedCountryCode}
              onChange={(e) => setSelectedCountryCode(e.target.value)}
            >
              {countryOptions.map(country => (
                <option key={country.id} value={country.phone_code}>
                  {country.phone_code} {country.name}
                </option>
              ))}
            </select>
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
          <label className="block font-semibold mb-1">Topic:</label>
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
        <div className="pt-4">
          <button 
            type="submit" 
            className={`btn btn-primary w-full text-lg font-semibold ${isLoading ? 'loading' : ''}`}
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