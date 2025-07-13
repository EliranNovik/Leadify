import React, { useState } from 'react';
import { MagnifyingGlassIcon, Squares2X2Icon, ArrowUturnDownIcon, DocumentDuplicateIcon, ChartPieIcon, AdjustmentsHorizontalIcon, FunnelIcon, ClockIcon, ArrowPathIcon, CheckCircleIcon, BanknotesIcon, UserGroupIcon, UserIcon, AcademicCapIcon, StarIcon, PlusIcon, ClipboardDocumentCheckIcon, ChartBarIcon, ListBulletIcon, CurrencyDollarIcon, BriefcaseIcon, ArrowLeftIcon } from '@heroicons/react/24/solid';
import FullSearchReport from './FullSearchReport';
import { supabase } from '../lib/supabase';

// Stage Search Report Component
const StageSearchReport = () => {
  const [filters, setFilters] = useState({
    fromDate: '',
    toDate: '',
    stage: '',
    category: '',
  });
  const [results, setResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchPerformed, setSearchPerformed] = useState(false);

  // Dropdown options
  const stageOptions = [
    "created", "scheduler_assigned", "meeting_scheduled", "meeting_paid", "unactivated", 
    "communication_started", "another_meeting", "revised_offer", "offer_sent", 
    "waiting_for_mtng_sum", "client_signed", "client_declined", "lead_summary", 
    "meeting_rescheduled", "meeting_ended"
  ];
  const categoryOptions = ["German Citizenship", "Austrian Citizenship", "Immigration to Israel"];

  const handleFilterChange = (field: string, value: any) => {
    setFilters(prev => ({ ...prev, [field]: value }));
  };

  const handleSearch = async () => {
    setIsSearching(true);
    setSearchPerformed(true);
    try {
      let query = supabase.from('leads').select('*');

      // Apply filters
      if (filters.fromDate) query = query.gte('created_at', filters.fromDate);
      if (filters.toDate) query = query.lte('created_at', filters.toDate);
      if (filters.stage) query = query.eq('stage', filters.stage);
      if (filters.category) query = query.ilike('category', `%${filters.category}%`);

      const { data, error } = await query.order('created_at', { ascending: false });

      if (error) throw error;
      setResults(data || []);
    } catch (error) {
      console.error('Error searching leads:', error);
      alert('Failed to search for leads.');
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const getStageBadge = (stage: string) => {
    const stageText = stage.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    return (
      <span 
        className="badge text-white text-xs px-2 py-1 rounded-full font-medium whitespace-nowrap"
        style={{ backgroundColor: '#3b28c7', minWidth: 'fit-content' }}
      >
        {stageText}
      </span>
    );
  };

  const renderResultCard = (lead: any) => (
    <div 
      key={lead.id} 
      className="card bg-base-100 shadow-lg hover:shadow-2xl transition-all duration-300 ease-in-out transform hover:-translate-y-1 cursor-pointer group"
    >
      <div className="card-body p-5">
        <div className="flex justify-between items-start mb-2">
          <h2 className="card-title text-xl font-bold group-hover:text-primary transition-colors">
            {lead.name}
          </h2>
          {getStageBadge(lead.stage)}
        </div>
        
        <p className="text-sm text-base-content/60 font-mono mb-4">#{lead.lead_number}</p>

        <div className="divider my-0"></div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm mt-4">
          <div className="flex items-center gap-2" title="Date Created">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-base-content/50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
            <span className="font-medium">{new Date(lead.created_at).toLocaleDateString()}</span>
          </div>
          <div className="flex items-center gap-2" title="Category">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-base-content/50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
            <span>{lead.category || 'N/A'}</span>
          </div>
          <div className="flex items-center gap-2" title="Source">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-base-content/50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            <span>{lead.source || 'N/A'}</span>
          </div>
          <div className="flex items-center gap-2" title="Language">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-base-content/50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" /></svg>
            <span>{lead.language || 'N/A'}</span>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-base-200/50">
          <p className="text-sm font-semibold text-base-content/80">{lead.topic || 'No topic specified'}</p>
        </div>
      </div>
    </div>
  );

  return (
    <div>
      {/* Search Form */}
      <div className="card bg-base-200 shadow-lg p-6 mb-8">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
          <div className="form-control">
            <label className="label mb-2"><span className="label-text">From Date</span></label>
            <input 
              type="date" 
              className="input input-bordered" 
              onChange={e => handleFilterChange('fromDate', e.target.value)} 
            />
          </div>
          <div className="form-control">
            <label className="label mb-2"><span className="label-text">To Date</span></label>
            <input 
              type="date" 
              className="input input-bordered" 
              onChange={e => handleFilterChange('toDate', e.target.value)} 
            />
          </div>
          <div className="form-control">
            <label className="label mb-2"><span className="label-text">Stage</span></label>
            <select 
              className="select select-bordered" 
              onChange={e => handleFilterChange('stage', e.target.value)}
            >
              <option value="">All Stages</option>
              {stageOptions.map(opt => (
                <option key={opt} value={opt}>
                  {opt.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                </option>
              ))}
            </select>
          </div>
          <div className="form-control">
            <label className="label mb-2"><span className="label-text">Category</span></label>
            <select 
              className="select select-bordered" 
              onChange={e => handleFilterChange('category', e.target.value)}
            >
              <option value="">All Categories</option>
              {categoryOptions.map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>
          <div className="form-control">
            <button 
              className="btn btn-primary w-full" 
              onClick={handleSearch}
              disabled={isSearching}
            >
              {isSearching ? 'Searching...' : 'Search'}
            </button>
          </div>
        </div>
      </div>

      {/* Results */}
      {searchPerformed && (
        <div>
          <h2 className="text-2xl font-bold mb-4">
            Found {results.length} lead{results.length !== 1 && 's'}
          </h2>
          {isSearching ? (
            <div className="flex justify-center p-8">
              <span className="loading loading-spinner loading-lg"></span>
            </div>
          ) : results.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {results.map(renderResultCard)}
            </div>
          ) : (
            <div className="text-center p-8 bg-base-200 rounded-lg">
              No leads found matching your criteria.
            </div>
          )}
        </div>
      )}
    </div>
  );
};
// Anchor Search Report Component
const AnchorSearchReport = () => {
  const [filters, setFilters] = useState({
    name: '',
    dateOfBirth: '',
    placeOfBirth: '',
  });
  const [results, setResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchPerformed, setSearchPerformed] = useState(false);

  const handleFilterChange = (field: string, value: any) => {
    setFilters(prev => ({ ...prev, [field]: value }));
  };

  const handleSearch = async () => {
    setIsSearching(true);
    setSearchPerformed(true);
    try {
      let query = supabase.from('leads').select('*');

      // Apply filters
      if (filters.name) query = query.ilike('name', `%${filters.name}%`);
      if (filters.dateOfBirth) query = query.eq('date_of_birth', filters.dateOfBirth);
      if (filters.placeOfBirth) query = query.ilike('place_of_birth', `%${filters.placeOfBirth}%`);

      const { data, error } = await query.order('created_at', { ascending: false });

      if (error) throw error;
      setResults(data || []);
    } catch (error) {
      console.error('Error searching leads:', error);
      alert('Failed to search for leads.');
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const getStageBadge = (stage: string) => {
    const stageText = stage.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    return (
      <span 
        className="badge text-white text-xs px-2 py-1 rounded-full font-medium whitespace-nowrap"
        style={{ backgroundColor: '#3b28c7', minWidth: 'fit-content' }}
      >
        {stageText}
      </span>
    );
  };

  const renderResultCard = (lead: any) => (
    <div 
      key={lead.id} 
      className="card bg-base-100 shadow-lg hover:shadow-2xl transition-all duration-300 ease-in-out transform hover:-translate-y-1 cursor-pointer group"
    >
      <div className="card-body p-5">
        <div className="flex justify-between items-start mb-2">
          <h2 className="card-title text-xl font-bold group-hover:text-primary transition-colors">
            {lead.name}
          </h2>
          {getStageBadge(lead.stage)}
        </div>
        
        <p className="text-sm text-base-content/60 font-mono mb-4">#{lead.lead_number}</p>

        <div className="divider my-0"></div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm mt-4">
          <div className="flex items-center gap-2" title="Date of Birth">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-base-content/50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
            <span className="font-medium">{lead.date_of_birth ? new Date(lead.date_of_birth).toLocaleDateString() : 'N/A'}</span>
          </div>
          <div className="flex items-center gap-2" title="Place of Birth">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-base-content/50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
            <span>{lead.place_of_birth || 'N/A'}</span>
          </div>
          <div className="flex items-center gap-2" title="Category">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-base-content/50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
            <span>{lead.category || 'N/A'}</span>
          </div>
          <div className="flex items-center gap-2" title="Language">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-base-content/50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" /></svg>
            <span>{lead.language || 'N/A'}</span>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-base-200/50">
          <p className="text-sm font-semibold text-base-content/80">{lead.topic || 'No topic specified'}</p>
        </div>
      </div>
    </div>
  );

  return (
    <div>
      {/* Search Form */}
      <div className="card bg-base-200 shadow-lg p-6 mb-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          <div className="form-control">
            <label className="label mb-2"><span className="label-text">Name</span></label>
            <input 
              type="text" 
              className="input input-bordered" 
              placeholder="Search by name..."
              onChange={e => handleFilterChange('name', e.target.value)} 
            />
          </div>
          <div className="form-control">
            <label className="label mb-2"><span className="label-text">Date of Birth</span></label>
            <input 
              type="date" 
              className="input input-bordered" 
              onChange={e => handleFilterChange('dateOfBirth', e.target.value)} 
            />
          </div>
          <div className="form-control">
            <label className="label mb-2"><span className="label-text">Place of Birth</span></label>
            <input 
              type="text" 
              className="input input-bordered" 
              placeholder="Search by place of birth..."
              onChange={e => handleFilterChange('placeOfBirth', e.target.value)} 
            />
          </div>
          <div className="form-control">
            <button 
              className="btn btn-primary w-full" 
              onClick={handleSearch}
              disabled={isSearching}
            >
              {isSearching ? 'Searching...' : 'Search'}
            </button>
          </div>
        </div>
      </div>

      {/* Results */}
      {searchPerformed && (
        <div>
          <h2 className="text-2xl font-bold mb-4">
            Found {results.length} lead{results.length !== 1 && 's'}
          </h2>
          {isSearching ? (
            <div className="flex justify-center p-8">
              <span className="loading loading-spinner loading-lg"></span>
            </div>
          ) : results.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {results.map(renderResultCard)}
            </div>
          ) : (
            <div className="text-center p-8 bg-base-200 rounded-lg">
              No leads found matching your criteria.
            </div>
          )}
        </div>
      )}
    </div>
  );
};
// Duplicate Search Report Component
const DuplicateSearchReport = () => {
  const [filters, setFilters] = useState({
    fromDate: '',
    toDate: '',
    status: '',
    stage: '',
    category: '',
    language: '',
    source: '',
  });
  const [results, setResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchPerformed, setSearchPerformed] = useState(false);

  // Dropdown options
  const statusOptions = ["active", "non active"];
  const stageOptions = [
    "created", "scheduler_assigned", "meeting_scheduled", "meeting_paid", "unactivated", 
    "communication_started", "another_meeting", "revised_offer", "offer_sent", 
    "waiting_for_mtng_sum", "client_signed", "client_declined", "lead_summary", 
    "meeting_rescheduled", "meeting_ended"
  ];
  const categoryOptions = ["German Citizenship", "Austrian Citizenship", "Immigration to Israel"];
  const languageOptions = ["English", "Hebrew", "German", "French", "Russian", "Other"];
  const sourceOptions = ["Manual", "AI Assistant", "Referral", "Website", "Other"];

  const handleFilterChange = (field: string, value: any) => {
    setFilters(prev => ({ ...prev, [field]: value }));
  };

  const handleSearch = async () => {
    setIsSearching(true);
    setSearchPerformed(true);
    try {
      // First, get all leads with applied filters
      let query = supabase.from('leads').select('*');

      // Apply filters
      if (filters.fromDate) query = query.gte('created_at', filters.fromDate);
      if (filters.toDate) query = query.lte('created_at', filters.toDate);
      if (filters.status) query = query.eq('status', filters.status);
      if (filters.stage) query = query.eq('stage', filters.stage);
      if (filters.category) query = query.ilike('category', `%${filters.category}%`);
      if (filters.language) query = query.eq('language', filters.language);
      if (filters.source) query = query.ilike('source', `%${filters.source}%`);

      const { data: allLeads, error } = await query.order('created_at', { ascending: false });

      if (error) throw error;

      // Find duplicates based on email or name
      const duplicates: any[] = [];
      const seenEmails = new Map();
      const seenNames = new Map();

      allLeads?.forEach(lead => {
        let isDuplicate = false;

        // Check for email duplicates
        if (lead.email && lead.email.trim() !== '') {
          const email = lead.email.toLowerCase().trim();
          if (seenEmails.has(email)) {
            // This is a duplicate email
            isDuplicate = true;
            // Mark both the original and current as duplicates
            if (!duplicates.find(d => d.id === seenEmails.get(email).id)) {
              duplicates.push({
                ...seenEmails.get(email),
                duplicateType: 'email',
                duplicateValue: email,
                duplicateWith: lead.name
              });
            }
          } else {
            seenEmails.set(email, lead);
          }
        }

        // Check for name duplicates
        if (lead.name && lead.name.trim() !== '') {
          const name = lead.name.toLowerCase().trim();
          if (seenNames.has(name)) {
            // This is a duplicate name
            isDuplicate = true;
            // Mark both the original and current as duplicates
            if (!duplicates.find(d => d.id === seenNames.get(name).id)) {
              duplicates.push({
                ...seenNames.get(name),
                duplicateType: 'name',
                duplicateValue: name,
                duplicateWith: lead.email
              });
            }
          } else {
            seenNames.set(name, lead);
          }
        }

        // Add current lead if it's a duplicate
        if (isDuplicate) {
          let duplicateType = '';
          let duplicateValue = '';
          let duplicateWith = '';

          if (lead.email && seenEmails.has(lead.email.toLowerCase().trim()) && seenEmails.get(lead.email.toLowerCase().trim()).id !== lead.id) {
            duplicateType = 'email';
            duplicateValue = lead.email.toLowerCase().trim();
            duplicateWith = seenEmails.get(lead.email.toLowerCase().trim()).name;
          } else if (lead.name && seenNames.has(lead.name.toLowerCase().trim()) && seenNames.get(lead.name.toLowerCase().trim()).id !== lead.id) {
            duplicateType = 'name';
            duplicateValue = lead.name.toLowerCase().trim();
            duplicateWith = seenNames.get(lead.name.toLowerCase().trim()).email;
          }

          duplicates.push({
            ...lead,
            duplicateType,
            duplicateValue,
            duplicateWith
          });
        }
      });

      setResults(duplicates);
    } catch (error) {
      console.error('Error searching for duplicates:', error);
      alert('Failed to search for duplicate leads.');
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const getStageBadge = (stage: string) => {
    const stageText = stage.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    return (
      <span 
        className="badge text-white text-xs px-2 py-1 rounded-full font-medium whitespace-nowrap"
        style={{ backgroundColor: '#3b28c7', minWidth: 'fit-content' }}
      >
        {stageText}
      </span>
    );
  };

  const getDuplicateBadge = (type: string) => {
    return (
      <span 
        className="badge text-white text-xs px-2 py-1 rounded-full font-medium whitespace-nowrap"
        style={{ backgroundColor: '#dc2626', minWidth: 'fit-content' }}
      >
        Duplicate {type}
      </span>
    );
  };

  const renderResultCard = (lead: any) => (
    <div 
      key={lead.id} 
      className="card bg-base-100 shadow-lg hover:shadow-2xl transition-all duration-300 ease-in-out transform hover:-translate-y-1 cursor-pointer group border-l-4 border-red-500"
    >
      <div className="card-body p-5">
        <div className="flex justify-between items-start mb-2">
          <h2 className="card-title text-xl font-bold group-hover:text-primary transition-colors">
            {lead.name}
          </h2>
          <div className="flex flex-col gap-1">
            {getStageBadge(lead.stage)}
            {getDuplicateBadge(lead.duplicateType)}
          </div>
        </div>
        
        <p className="text-sm text-base-content/60 font-mono mb-2">#{lead.lead_number}</p>
        <p className="text-sm text-red-600 font-medium mb-4">
          Duplicate {lead.duplicateType}: {lead.duplicateValue}
          {lead.duplicateWith && (
            <span className="block text-xs text-gray-500">
              Matches with: {lead.duplicateWith}
            </span>
          )}
        </p>

        <div className="divider my-0"></div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm mt-4">
          <div className="flex items-center gap-2" title="Email">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-base-content/50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207" /></svg>
            <span className="font-medium truncate">{lead.email || 'N/A'}</span>
          </div>
          <div className="flex items-center gap-2" title="Date Created">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-base-content/50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
            <span className="font-medium">{new Date(lead.created_at).toLocaleDateString()}</span>
          </div>
          <div className="flex items-center gap-2" title="Category">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-base-content/50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
            <span>{lead.category || 'N/A'}</span>
          </div>
          <div className="flex items-center gap-2" title="Source">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-base-content/50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            <span>{lead.source || 'N/A'}</span>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-base-200/50">
          <p className="text-sm font-semibold text-base-content/80">{lead.topic || 'No topic specified'}</p>
        </div>
      </div>
    </div>
  );

  return (
    <div>
      {/* Search Form */}
      <div className="card bg-base-200 shadow-lg p-6 mb-8">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4 items-end">
          <div className="form-control">
            <label className="label mb-2"><span className="label-text">From Date</span></label>
            <input 
              type="date" 
              className="input input-bordered" 
              onChange={e => handleFilterChange('fromDate', e.target.value)} 
            />
          </div>
          <div className="form-control">
            <label className="label mb-2"><span className="label-text">To Date</span></label>
            <input 
              type="date" 
              className="input input-bordered" 
              onChange={e => handleFilterChange('toDate', e.target.value)} 
            />
          </div>
          <div className="form-control">
            <label className="label mb-2"><span className="label-text">Status</span></label>
            <select 
              className="select select-bordered" 
              onChange={e => handleFilterChange('status', e.target.value)}
            >
              <option value="">All Status</option>
              {statusOptions.map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>
          <div className="form-control">
            <label className="label mb-2"><span className="label-text">Stage</span></label>
            <select 
              className="select select-bordered" 
              onChange={e => handleFilterChange('stage', e.target.value)}
            >
              <option value="">All Stages</option>
              {stageOptions.map(opt => (
                <option key={opt} value={opt}>
                  {opt.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                </option>
              ))}
            </select>
          </div>
          <div className="form-control">
            <label className="label mb-2"><span className="label-text">Category</span></label>
            <select 
              className="select select-bordered" 
              onChange={e => handleFilterChange('category', e.target.value)}
            >
              <option value="">All Categories</option>
              {categoryOptions.map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>
          <div className="form-control">
            <label className="label mb-2"><span className="label-text">Language</span></label>
            <select 
              className="select select-bordered" 
              onChange={e => handleFilterChange('language', e.target.value)}
            >
              <option value="">All Languages</option>
              {languageOptions.map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>
          <div className="form-control">
            <label className="label mb-2"><span className="label-text">Source</span></label>
            <select 
              className="select select-bordered" 
              onChange={e => handleFilterChange('source', e.target.value)}
            >
              <option value="">All Sources</option>
              {sourceOptions.map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>
          <div className="form-control">
            <button 
              className="btn btn-primary w-full" 
              onClick={handleSearch}
              disabled={isSearching}
            >
              {isSearching ? 'Searching...' : 'Find Duplicates'}
            </button>
          </div>
        </div>
      </div>

      {/* Results */}
      {searchPerformed && (
        <div>
          <h2 className="text-2xl font-bold mb-4 text-red-600">
            Found {results.length} duplicate lead{results.length !== 1 && 's'}
          </h2>
          {isSearching ? (
            <div className="flex justify-center p-8">
              <span className="loading loading-spinner loading-lg"></span>
            </div>
          ) : results.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {results.map(renderResultCard)}
            </div>
          ) : (
            <div className="text-center p-8 bg-base-200 rounded-lg">
              No duplicate leads found matching your criteria.
            </div>
          )}
        </div>
      )}
    </div>
  );
};
// Sources Pie Report Component
const SourcesPieReport = () => {
  const [filters, setFilters] = useState({
    fromDate: '',
    toDate: '',
    status: '',
    stage: '',
    category: '',
    language: '',
  });
  const [results, setResults] = useState<any[]>([]);
  const [sourceData, setSourceData] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchPerformed, setSearchPerformed] = useState(false);

  // Dropdown options
  const statusOptions = ["active", "non active"];
  const stageOptions = [
    "created", "scheduler_assigned", "meeting_scheduled", "meeting_paid", "unactivated", 
    "communication_started", "another_meeting", "revised_offer", "offer_sent", 
    "waiting_for_mtng_sum", "client_signed", "client_declined", "lead_summary", 
    "meeting_rescheduled", "meeting_ended"
  ];
  const categoryOptions = ["German Citizenship", "Austrian Citizenship", "Immigration to Israel"];
  const languageOptions = ["English", "Hebrew", "German", "French", "Russian", "Other"];

  // Fake source links mapping
  const sourceLinks = {
    'Manual': 'https://lawoffice.org.il/manual-entry',
    'AI Assistant': 'https://lawoffice.org.il/ai-chat-bot',
    'Referral': 'https://lawoffice.org.il/referral-program',
    'Website': 'https://lawoffice.org.il/contact-form',
    'Google Ads': 'https://lawoffice.org.il/google-campaign',
    'Facebook': 'https://lawoffice.org.il/facebook-ads',
    'LinkedIn': 'https://lawoffice.org.il/linkedin-campaign',
    'Email Campaign': 'https://lawoffice.org.il/newsletter',
    'Phone Inquiry': 'https://lawoffice.org.il/phone-contact',
    'Other': 'https://lawoffice.org.il/other-sources'
  };

  const handleFilterChange = (field: string, value: any) => {
    setFilters(prev => ({ ...prev, [field]: value }));
  };

  const handleSearch = async () => {
    setIsSearching(true);
    setSearchPerformed(true);
    try {
      let query = supabase.from('leads').select('*');

      // Apply filters
      if (filters.fromDate) query = query.gte('created_at', filters.fromDate);
      if (filters.toDate) query = query.lte('created_at', filters.toDate);
      if (filters.status) query = query.eq('status', filters.status);
      if (filters.stage) query = query.eq('stage', filters.stage);
      if (filters.category) query = query.ilike('category', `%${filters.category}%`);
      if (filters.language) query = query.eq('language', filters.language);

      const { data, error } = await query.order('created_at', { ascending: false });

      if (error) throw error;

      setResults(data || []);

      // Process source data for pie chart and table
      const sourceCounts = (data || []).reduce((acc: any, lead: any) => {
        const source = lead.source || 'Unknown';
        acc[source] = (acc[source] || 0) + 1;
        return acc;
      }, {});

      const total = Object.values(sourceCounts).reduce((sum: number, count: any) => sum + count, 0);
      
      const processedSourceData = Object.entries(sourceCounts).map(([source, count]) => ({
        source,
        count,
        percentage: total > 0 ? ((count as number / total) * 100).toFixed(1) : '0.0',
        link: sourceLinks[source as keyof typeof sourceLinks] || 'https://lawoffice.org.il/unknown-source'
      })).sort((a, b) => b.count - a.count);

      setSourceData(processedSourceData);
    } catch (error) {
      console.error('Error searching leads:', error);
      alert('Failed to search for leads.');
      setResults([]);
      setSourceData([]);
    } finally {
      setIsSearching(false);
    }
  };

  // Enhanced interactive pie chart component
  const PieChart = ({ data }: { data: any[] }) => {
    const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
    const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });

    const colors = [
      '#3b28c7', '#dc2626', '#059669', '#d97706', '#7c3aed', 
      '#db2777', '#0891b2', '#65a30d', '#f59e0b', '#6366f1'
    ];
    
    let currentAngle = 0;
    const radius = 180;
    const hoverRadius = 190;
    const centerX = 250;
    const centerY = 250;

    const handleMouseMove = (e: React.MouseEvent) => {
      const rect = e.currentTarget.getBoundingClientRect();
      setMousePosition({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      });
    };

    return (
      <div className="flex flex-col items-center">
        <div className="relative">
          <svg 
            width="500" 
            height="500" 
            className="mb-6 drop-shadow-lg"
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setHoveredIndex(null)}
          >
            {/* Gradient definitions */}
            <defs>
              {colors.map((color, index) => (
                <radialGradient key={index} id={`gradient-${index}`} cx="0.3" cy="0.3">
                  <stop offset="0%" stopColor={color} stopOpacity="0.8" />
                  <stop offset="100%" stopColor={color} stopOpacity="1" />
                </radialGradient>
              ))}
              
              {/* Drop shadow filter */}
              <filter id="dropshadow" x="-50%" y="-50%" width="200%" height="200%">
                <feDropShadow dx="2" dy="4" stdDeviation="3" floodOpacity="0.3"/>
              </filter>
            </defs>

            {data.map((item, index) => {
              const angle = (parseFloat(item.percentage) / 100) * 360;
              const startAngle = currentAngle;
              const endAngle = currentAngle + angle;
              const isHovered = hoveredIndex === index;
              const currentRadius = isHovered ? hoverRadius : radius;
              
              const x1 = centerX + currentRadius * Math.cos((startAngle * Math.PI) / 180);
              const y1 = centerY + currentRadius * Math.sin((startAngle * Math.PI) / 180);
              const x2 = centerX + currentRadius * Math.cos((endAngle * Math.PI) / 180);
              const y2 = centerY + currentRadius * Math.sin((endAngle * Math.PI) / 180);
              
              const largeArcFlag = angle > 180 ? 1 : 0;
              
              const pathData = [
                `M ${centerX} ${centerY}`,
                `L ${x1} ${y1}`,
                `A ${currentRadius} ${currentRadius} 0 ${largeArcFlag} 1 ${x2} ${y2}`,
                'Z'
              ].join(' ');
              
              currentAngle += angle;
              
              return (
                <g key={index}>
                  <path
                    d={pathData}
                    fill={`url(#gradient-${index})`}
                    stroke="white"
                    strokeWidth="3"
                    filter="url(#dropshadow)"
                    className="cursor-pointer transition-all duration-300 ease-out"
                    style={{
                      transformOrigin: `${centerX}px ${centerY}px`,
                      transform: isHovered ? 'scale(1.02)' : 'scale(1)',
                    }}
                    onMouseEnter={() => setHoveredIndex(index)}
                  />
                  
                  {/* Label on slice for larger percentages */}
                  {parseFloat(item.percentage) > 8 && (
                    <text
                      x={centerX + (currentRadius * 0.7) * Math.cos(((startAngle + endAngle) / 2 * Math.PI) / 180)}
                      y={centerY + (currentRadius * 0.7) * Math.sin(((startAngle + endAngle) / 2 * Math.PI) / 180)}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      className="pointer-events-none"
                      style={{ 
                        fill: 'white',
                        fontSize: isHovered ? '16px' : '14px',
                        fontWeight: 'bold',
                        textShadow: '2px 2px 4px rgba(0,0,0,0.9)',
                        stroke: 'rgba(0,0,0,0.3)',
                        strokeWidth: '0.5px'
                      }}
                    >
                      {item.percentage}%
                    </text>
                  )}
                </g>
              );
            })}
            
            {/* Enhanced center circle */}
            <circle
              cx={centerX}
              cy={centerY}
              r="50"
              fill="white"
              stroke="#e5e7eb"
              strokeWidth="3"
              filter="url(#dropshadow)"
            />
            <text
              x={centerX}
              y={centerY - 8}
              textAnchor="middle"
              className="text-lg font-bold fill-gray-700"
            >
              Total
            </text>
            <text
              x={centerX}
              y={centerY + 12}
              textAnchor="middle"
              className="text-sm font-semibold fill-gray-600"
            >
              {data.reduce((sum, item) => sum + item.count, 0)} leads
            </text>
          </svg>

          {/* Hover tooltip */}
          {hoveredIndex !== null && (
            <div 
              className="absolute bg-gray-900 text-white px-4 py-3 rounded-lg shadow-xl z-10 pointer-events-none transition-all duration-200"
              style={{
                left: mousePosition.x + 10,
                top: mousePosition.y - 10,
                transform: 'translate(0, -100%)'
              }}
            >
              <div className="text-sm font-bold">{data[hoveredIndex].source}</div>
              <div className="text-xs text-gray-300">
                {data[hoveredIndex].count} leads ({data[hoveredIndex].percentage}%)
              </div>
              <div className="text-xs text-blue-300">
                Click to view details
              </div>
            </div>
          )}
        </div>
        
        {/* Enhanced Legend */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 max-w-4xl">
          {data.map((item, index) => (
            <div 
              key={index} 
              className={`flex items-center gap-3 p-2 rounded-lg transition-all duration-200 cursor-pointer ${
                hoveredIndex === index ? 'bg-gray-100 shadow-md transform scale-105' : 'hover:bg-gray-50'
              }`}
              onMouseEnter={() => setHoveredIndex(index)}
              onMouseLeave={() => setHoveredIndex(null)}
            >
              <div 
                className="w-5 h-5 rounded-full shadow-sm border-2 border-white"
                style={{ backgroundColor: colors[index % colors.length] }}
              />
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-gray-800">{item.source}</span>
                <span className="text-xs text-gray-500">{item.count} leads ({item.percentage}%)</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div>
      {/* Search Form */}
      <div className="card bg-base-200 shadow-lg p-6 mb-8">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-4 items-end">
          <div className="form-control">
            <label className="label mb-2"><span className="label-text">From Date</span></label>
            <input 
              type="date" 
              className="input input-bordered" 
              onChange={e => handleFilterChange('fromDate', e.target.value)} 
            />
          </div>
          <div className="form-control">
            <label className="label mb-2"><span className="label-text">To Date</span></label>
            <input 
              type="date" 
              className="input input-bordered" 
              onChange={e => handleFilterChange('toDate', e.target.value)} 
            />
          </div>
          <div className="form-control">
            <label className="label mb-2"><span className="label-text">Status</span></label>
            <select 
              className="select select-bordered" 
              onChange={e => handleFilterChange('status', e.target.value)}
            >
              <option value="">All Status</option>
              {statusOptions.map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>
          <div className="form-control">
            <label className="label mb-2"><span className="label-text">Stage</span></label>
            <select 
              className="select select-bordered" 
              onChange={e => handleFilterChange('stage', e.target.value)}
            >
              <option value="">All Stages</option>
              {stageOptions.map(opt => (
                <option key={opt} value={opt}>
                  {opt.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                </option>
              ))}
            </select>
          </div>
          <div className="form-control">
            <label className="label mb-2"><span className="label-text">Category</span></label>
            <select 
              className="select select-bordered" 
              onChange={e => handleFilterChange('category', e.target.value)}
            >
              <option value="">All Categories</option>
              {categoryOptions.map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>
          <div className="form-control">
            <label className="label mb-2"><span className="label-text">Language</span></label>
            <select 
              className="select select-bordered" 
              onChange={e => handleFilterChange('language', e.target.value)}
            >
              <option value="">All Languages</option>
              {languageOptions.map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>
          <div className="form-control">
            <button 
              className="btn btn-primary w-full" 
              onClick={handleSearch}
              disabled={isSearching}
            >
              {isSearching ? 'Analyzing...' : 'Analyze Sources'}
            </button>
          </div>
        </div>
      </div>

      {/* Results */}
      {searchPerformed && (
        <div>
          <h2 className="text-2xl font-bold mb-6">
            Source Analysis - {results.length} leads analyzed
          </h2>
          
          {isSearching ? (
            <div className="flex justify-center p-8">
              <span className="loading loading-spinner loading-lg"></span>
            </div>
          ) : sourceData.length > 0 ? (
            <div>
              {/* Pie Chart */}
              <div className="bg-white rounded-xl shadow-lg p-8 mb-8 border border-base-200">
                <h3 className="text-xl font-bold mb-6 text-center">Lead Sources Distribution</h3>
                <div className="flex justify-center">
                  <PieChart data={sourceData} />
                </div>
              </div>
              
              {/* Source Table */}
              <div className="bg-white rounded-xl shadow-lg p-8 border border-base-200">
                <h3 className="text-xl font-bold mb-6">Detailed Source Breakdown</h3>
                <div className="overflow-x-auto">
                  <table className="table w-full">
                    <thead>
                      <tr className="bg-base-200">
                        <th className="text-left">Source</th>
                        <th className="text-center">Number of Leads</th>
                        <th className="text-center">Percentage</th>
                        <th className="text-left">Source Link</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sourceData.map((item, index) => (
                        <tr key={index} className="hover:bg-base-50">
                          <td>
                            <div className="flex items-center gap-3">
                              <div 
                                className="w-4 h-4 rounded"
                                style={{ backgroundColor: ['#3b28c7', '#dc2626', '#059669', '#d97706', '#7c3aed', '#db2777', '#0891b2', '#65a30d', '#dc2626', '#6366f1'][index % 10] }}
                              />
                              <span className="font-semibold">{item.source}</span>
                            </div>
                          </td>
                          <td className="text-center">
                            <span className="badge badge-primary">{item.count}</span>
                          </td>
                          <td className="text-center">
                            <span className="font-bold text-lg">{item.percentage}%</span>
                          </td>
                          <td>
                            <a 
                              href={item.link} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="link link-primary text-sm hover:underline"
                            >
                              {item.link}
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center p-8 bg-base-200 rounded-lg">
              No leads found matching your criteria to analyze sources.
            </div>
          )}
        </div>
      )}
    </div>
  );
};
// Category & Source Report Component
const CategorySourceReport = () => {
  const [filters, setFilters] = useState({
    fromDate: '',
    toDate: '',
    source: '',
  });
  const [results, setResults] = useState<any[]>([]);
  const [stageData, setStageData] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchPerformed, setSearchPerformed] = useState(false);

  // Dropdown options
  const sourceOptions = ["Manual", "AI Assistant", "Referral", "Website", "Google Ads", "Facebook", "LinkedIn", "Email Campaign", "Phone Inquiry", "Other"];

  const handleFilterChange = (field: string, value: any) => {
    setFilters(prev => ({ ...prev, [field]: value }));
  };

  const handleSearch = async () => {
    setIsSearching(true);
    setSearchPerformed(true);
    try {
      let query = supabase.from('leads').select('*');

      // Apply filters
      if (filters.fromDate) query = query.gte('created_at', filters.fromDate);
      if (filters.toDate) query = query.lte('created_at', filters.toDate);
      if (filters.source) query = query.ilike('source', `%${filters.source}%`);

      const { data, error } = await query.order('created_at', { ascending: false });

      if (error) throw error;

      setResults(data || []);

      // Process stage data for table
      const stageCounts = (data || []).reduce((acc: any, lead: any) => {
        const stage = lead.stage || 'Unknown';
        acc[stage] = (acc[stage] || 0) + 1;
        return acc;
      }, {});

      // Define stage priority order (higher number = more advanced stage)
      const stagePriority: { [key: string]: number } = {
        'created': 1,
        'scheduler_assigned': 2,
        'meeting_scheduled': 3,
        'meeting_paid': 4,
        'communication_started': 5,
        'another_meeting': 6,
        'revised_offer': 7,
        'offer_sent': 8,
        'waiting_for_mtng_sum': 9,
        'meeting_ended': 10,
        'lead_summary': 11,
        'Mtng sum+Agreement sent': 12,
        'Client signed agreement': 13,
        'client_signed': 13,
        'payment_request_sent': 14,
        'finances_and_payments_plan': 15,
        'unactivated': 0,
        'client_declined': 0,
        'meeting_rescheduled': 3, // Same as meeting_scheduled
        'Unknown': 0
      };

      const processedStageData = Object.entries(stageCounts).map(([stage, count]) => ({
        stage: stage.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
        originalStage: stage,
        total: count,
        priority: stagePriority[stage] || 0
      })).sort((a, b) => {
        // First sort by priority (higher priority = more advanced stage)
        if (a.priority !== b.priority) {
          return b.priority - a.priority;
        }
        // If same priority, sort by count
        return b.total - a.total;
      });

      setStageData(processedStageData);
    } catch (error) {
      console.error('Error searching leads:', error);
      alert('Failed to search for leads.');
      setResults([]);
      setStageData([]);
    } finally {
      setIsSearching(false);
    }
  };

  const getStageBadge = (stage: string) => {
    return (
      <span 
        className="badge text-white text-xs px-2 py-1 rounded-full font-medium whitespace-nowrap"
        style={{ backgroundColor: '#3b28c7', minWidth: 'fit-content' }}
      >
        {stage}
      </span>
    );
  };

  return (
    <div>
      {/* Search Form */}
      <div className="card bg-base-200 shadow-lg p-6 mb-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          <div className="form-control">
            <label className="label mb-2"><span className="label-text">From Date</span></label>
            <input 
              type="date" 
              className="input input-bordered" 
              onChange={e => handleFilterChange('fromDate', e.target.value)} 
            />
          </div>
          <div className="form-control">
            <label className="label mb-2"><span className="label-text">To Date</span></label>
            <input 
              type="date" 
              className="input input-bordered" 
              onChange={e => handleFilterChange('toDate', e.target.value)} 
            />
          </div>
          <div className="form-control">
            <label className="label mb-2"><span className="label-text">Source</span></label>
            <select 
              className="select select-bordered" 
              onChange={e => handleFilterChange('source', e.target.value)}
            >
              <option value="">All Sources</option>
              {sourceOptions.map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>
          <div className="form-control">
            <button 
              className="btn btn-primary w-full" 
              onClick={handleSearch}
              disabled={isSearching}
            >
              {isSearching ? 'Analyzing...' : 'Analyze Stages'}
            </button>
          </div>
        </div>
      </div>

      {/* Results */}
      {searchPerformed && (
        <div>
          <h2 className="text-2xl font-bold mb-6">
            Stage Analysis - {results.length} leads analyzed
          </h2>
          
          {isSearching ? (
            <div className="flex justify-center p-8">
              <span className="loading loading-spinner loading-lg"></span>
            </div>
          ) : stageData.length > 0 ? (
            <div>
              {/* Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div className="card shadow-lg border-0 bg-gradient-to-br from-blue-500 via-blue-600 to-blue-700 text-white">
                  <div className="card-body text-center">
                    <h3 className="text-lg font-semibold text-blue-100">Total Leads</h3>
                    <p className="text-3xl font-bold text-white">{results.length}</p>
                  </div>
                </div>
                <div className="card shadow-lg border-0 bg-gradient-to-br from-green-500 via-green-600 to-green-700 text-white">
                  <div className="card-body text-center">
                    <h3 className="text-lg font-semibold text-green-100">Active Stages</h3>
                    <p className="text-3xl font-bold text-white">{stageData.length}</p>
                  </div>
                </div>
                <div className="card shadow-lg border-0 bg-gradient-to-br from-purple-500 via-purple-600 to-purple-700 text-white">
                  <div className="card-body text-center">
                    <h3 className="text-lg font-semibold text-purple-100">Top Stage</h3>
                    <div className="text-lg font-bold text-white">
                      {stageData[0]?.stage} ({stageData[0]?.total})
                    </div>
                  </div>
                </div>
              </div>

              {/* Stage Analysis Table */}
              <div className="bg-white rounded-xl shadow-lg p-8 border border-base-200">
                <h3 className="text-xl font-bold mb-6">Detailed Stage Breakdown</h3>
                <div className="overflow-x-auto">
                  <table className="table w-full">
                    <thead>
                      <tr className="bg-base-200">
                        <th className="text-left">Stage</th>
                        <th className="text-center">Total (Leads)</th>
                        <th className="text-center">Percentage</th>
                        <th className="text-center">Progress</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stageData.map((item, index) => {
                        const percentage = results.length > 0 ? ((item.total / results.length) * 100).toFixed(1) : '0.0';
                        return (
                          <tr key={index} className="hover:bg-base-50">
                            <td>
                              <div className="flex items-center gap-3">
                                <span className="text-lg">{index + 1}.</span>
                                {getStageBadge(item.stage)}
                              </div>
                            </td>
                            <td className="text-center">
                              <span className="text-xl font-bold text-gray-800">{item.total}</span>
                            </td>
                            <td className="text-center">
                              <span className="font-semibold text-lg">{percentage}%</span>
                            </td>
                            <td className="text-center">
                              <div className="w-full max-w-xs mx-auto">
                                <div className="w-full bg-gray-200 rounded-full h-3">
                                  <div 
                                    className="h-3 rounded-full transition-all duration-500"
                                    style={{ 
                                      width: `${percentage}%`,
                                      backgroundColor: '#3b28c7'
                                    }}
                                  />
                                </div>
                                <div className="text-xs text-gray-500 mt-1">{percentage}%</div>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Additional Insights */}
                <div className="mt-8 p-6 bg-gray-50 rounded-lg">
                  <h4 className="text-lg font-semibold mb-4">Key Insights</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="font-medium text-gray-600">Most Common Stage:</span>
                      <span className="ml-2 font-semibold">{stageData[0]?.stage} ({stageData[0]?.total} leads)</span>
                    </div>
                    <div>
                      <span className="font-medium text-gray-600">Least Common Stage:</span>
                      <span className="ml-2 font-semibold">{stageData[stageData.length - 1]?.stage} ({stageData[stageData.length - 1]?.total} leads)</span>
                    </div>
                    <div>
                      <span className="font-medium text-gray-600">Average per Stage:</span>
                      <span className="ml-2 font-semibold">{(results.length / stageData.length).toFixed(1)} leads</span>
                    </div>
                    <div>
                      <span className="font-medium text-gray-600">Date Range:</span>
                      <span className="ml-2 font-semibold">
                        {filters.fromDate || 'All time'} - {filters.toDate || 'Present'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center p-8 bg-base-200 rounded-lg">
              No leads found matching your criteria to analyze stages.
            </div>
          )}
        </div>
      )}
    </div>
  );
};
// Conversion Rate Report Component
const ConvertionReport = () => {
  const [filters, setFilters] = useState({
    fromDate: '',
    toDate: '',
    source: '',
    category: '',
  });
  const [results, setResults] = useState<any[]>([]);
  const [conversionData, setConversionData] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchPerformed, setSearchPerformed] = useState(false);

  // Dropdown options
  const sourceOptions = ["Manual", "AI Assistant", "Referral", "Website", "Google Ads", "Facebook", "LinkedIn", "Email Campaign", "Phone Inquiry", "Other"];
  const categoryOptions = ["German Citizenship", "Austrian Citizenship", "Immigration to Israel"];

  // Fake expense data per category (in currency)
  const categoryExpenses = {
    'German Citizenship': { marketing: 15000, salesTeam: 12000 },
    'Austrian Citizenship': { marketing: 8000, salesTeam: 7000 },
    'Immigration to Israel': { marketing: 5000, salesTeam: 4000 }
  };

  const handleFilterChange = (field: string, value: any) => {
    setFilters(prev => ({ ...prev, [field]: value }));
  };

  const handleSearch = async () => {
    setIsSearching(true);
    setSearchPerformed(true);
    try {
      let query = supabase.from('leads').select('*');

      // Apply filters
      if (filters.fromDate) query = query.gte('created_at', filters.fromDate);
      if (filters.toDate) query = query.lte('created_at', filters.toDate);
      if (filters.source) query = query.ilike('source', `%${filters.source}%`);
      if (filters.category) query = query.ilike('category', `%${filters.category}%`);

      const { data, error } = await query.order('created_at', { ascending: false });

      if (error) throw error;

      setResults(data || []);

      // Process conversion data by category
      const categoryStats = (data || []).reduce((acc: any, lead: any) => {
        const category = lead.category || 'Unknown';
        if (!acc[category]) {
          acc[category] = {
            leads: 0,
            meetings: 0,
            priceOffers: 0,
            success: 0
          };
        }
        
        acc[category].leads += 1;
        
        // Count meetings (stages that indicate a meeting happened)
        if (['meeting_scheduled', 'meeting_paid', 'meeting_ended', 'another_meeting'].includes(lead.stage)) {
          acc[category].meetings += 1;
        }
        
        // Count price offers (stages that indicate offer was sent)
        if (['offer_sent', 'revised_offer', 'waiting_for_mtng_sum', 'client_signed', 'Client signed agreement'].includes(lead.stage)) {
          acc[category].priceOffers += 1;
        }
        
        // Count success (will be 0 as requested since not implemented yet)
        acc[category].success = 0;
        
        return acc;
      }, {});

      const processedConversionData = Object.entries(categoryStats).map(([category, stats]: [string, any]) => {
        const expenses = categoryExpenses[category as keyof typeof categoryExpenses] || { marketing: 0, salesTeam: 0 };
        const total = expenses.marketing + expenses.salesTeam;
        const meetingRate = stats.leads > 0 ? ((stats.meetings / stats.leads) * 100).toFixed(1) : '0.0';
        const conversionRate = stats.leads > 0 ? ((stats.success / stats.leads) * 100).toFixed(1) : '0.0';
        
        return {
          category,
          marketingExpenses: expenses.marketing,
          salesTeamExpenses: expenses.salesTeam,
          leads: stats.leads,
          meetings: stats.meetings,
          meetingRate: `${meetingRate}%`,
          priceOffers: stats.priceOffers,
          success: stats.success,
          total,
          rate: `${conversionRate}%`
        };
      }).sort((a, b) => b.leads - a.leads);

      setConversionData(processedConversionData);
    } catch (error) {
      console.error('Error searching leads:', error);
      alert('Failed to search for leads.');
      setResults([]);
      setConversionData([]);
    } finally {
      setIsSearching(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  return (
    <div>
      {/* Search Form */}
      <div className="card bg-base-200 shadow-lg p-6 mb-8">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
          <div className="form-control">
            <label className="label mb-2"><span className="label-text">From Date</span></label>
            <input 
              type="date" 
              className="input input-bordered" 
              onChange={e => handleFilterChange('fromDate', e.target.value)} 
            />
          </div>
          <div className="form-control">
            <label className="label mb-2"><span className="label-text">To Date</span></label>
            <input 
              type="date" 
              className="input input-bordered" 
              onChange={e => handleFilterChange('toDate', e.target.value)} 
            />
          </div>
          <div className="form-control">
            <label className="label mb-2"><span className="label-text">Source</span></label>
            <select 
              className="select select-bordered" 
              onChange={e => handleFilterChange('source', e.target.value)}
            >
              <option value="">All Sources</option>
              {sourceOptions.map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>
          <div className="form-control">
            <label className="label mb-2"><span className="label-text">Category</span></label>
            <select 
              className="select select-bordered" 
              onChange={e => handleFilterChange('category', e.target.value)}
            >
              <option value="">All Categories</option>
              {categoryOptions.map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>
          <div className="form-control">
            <button 
              className="btn btn-primary w-full" 
              onClick={handleSearch}
              disabled={isSearching}
            >
              {isSearching ? 'Analyzing...' : 'Analyze Conversion'}
            </button>
          </div>
        </div>
      </div>

      {/* Results */}
      {searchPerformed && (
        <div>
          <h2 className="text-2xl font-bold mb-6">
            Marketing Conversion Analysis - {results.length} leads analyzed
          </h2>
          
          {isSearching ? (
            <div className="flex justify-center p-8">
              <span className="loading loading-spinner loading-lg"></span>
            </div>
          ) : conversionData.length > 0 ? (
            <div>
              {/* Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                <div className="card shadow-lg border-0 bg-gradient-to-br from-blue-500 via-blue-600 to-blue-700 text-white">
                  <div className="card-body text-center">
                    <h3 className="text-lg font-semibold text-blue-100">Total Leads</h3>
                    <p className="text-3xl font-bold text-white">{results.length}</p>
                  </div>
                </div>
                <div className="card shadow-lg border-0 bg-gradient-to-br from-green-500 via-green-600 to-green-700 text-white">
                  <div className="card-body text-center">
                    <h3 className="text-lg font-semibold text-green-100">Total Meetings</h3>
                    <p className="text-3xl font-bold text-white">
                      {conversionData.reduce((sum, item) => sum + item.meetings, 0)}
                    </p>
                  </div>
                </div>
                <div className="card shadow-lg border-0 bg-gradient-to-br from-purple-500 via-purple-600 to-purple-700 text-white">
                  <div className="card-body text-center">
                    <h3 className="text-lg font-semibold text-purple-100">Price Offers</h3>
                    <p className="text-3xl font-bold text-white">
                      {conversionData.reduce((sum, item) => sum + item.priceOffers, 0)}
                    </p>
                  </div>
                </div>
                <div className="card shadow-lg border-0 bg-gradient-to-br from-orange-500 via-orange-600 to-orange-700 text-white">
                  <div className="card-body text-center">
                    <h3 className="text-lg font-semibold text-orange-100">Total Expenses</h3>
                    <p className="text-3xl font-bold text-white">
                      {formatCurrency(conversionData.reduce((sum, item) => sum + item.total, 0))}
                    </p>
                  </div>
                </div>
              </div>

              {/* Conversion Analysis Table */}
              <div className="bg-white rounded-xl shadow-lg p-8 border border-base-200">
                <h3 className="text-xl font-bold mb-6">Detailed Conversion Breakdown</h3>
                <div className="overflow-x-auto">
                  <table className="table w-full">
                    <thead>
                      <tr className="bg-base-200">
                        <th className="text-left">Category</th>
                        <th className="text-center">Marketing Expenses</th>
                        <th className="text-center">Sales Team Expenses</th>
                        <th className="text-center">Leads</th>
                        <th className="text-center">Meetings</th>
                        <th className="text-center">Meeting Rate</th>
                        <th className="text-center">Price Offers</th>
                        <th className="text-center">Success</th>
                        <th className="text-center">Total</th>
                        <th className="text-center">Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {conversionData.map((item, index) => (
                        <tr key={index} className="hover:bg-base-50">
                          <td>
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-gray-800">{item.category}</span>
                            </div>
                          </td>
                          <td className="text-center">
                            <span className="text-sm font-medium text-green-600">
                              {formatCurrency(item.marketingExpenses)}
                            </span>
                          </td>
                          <td className="text-center">
                            <span className="text-sm font-medium text-blue-600">
                              {formatCurrency(item.salesTeamExpenses)}
                            </span>
                          </td>
                          <td className="text-center">
                            <span className="text-lg font-bold text-gray-800">{item.leads}</span>
                          </td>
                          <td className="text-center">
                            <span className="text-lg font-bold text-purple-600">{item.meetings}</span>
                          </td>
                          <td className="text-center">
                            <span className="badge badge-info font-semibold">{item.meetingRate}</span>
                          </td>
                          <td className="text-center">
                            <span className="text-lg font-bold text-orange-600">{item.priceOffers}</span>
                          </td>
                          <td className="text-center">
                            <span className="text-lg font-bold text-red-600">{item.success}</span>
                            <div className="text-xs text-gray-500">(Not implemented)</div>
                          </td>
                          <td className="text-center">
                            <span className="text-lg font-bold text-gray-800">
                              {formatCurrency(item.total)}
                            </span>
                          </td>
                          <td className="text-center">
                            <span className="badge badge-primary font-semibold text-base">
                              {item.rate}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-base-100 font-bold">
                        <td className="text-left">TOTALS</td>
                        <td className="text-center text-green-600">
                          {formatCurrency(conversionData.reduce((sum, item) => sum + item.marketingExpenses, 0))}
                        </td>
                        <td className="text-center text-blue-600">
                          {formatCurrency(conversionData.reduce((sum, item) => sum + item.salesTeamExpenses, 0))}
                        </td>
                        <td className="text-center text-gray-800">
                          {conversionData.reduce((sum, item) => sum + item.leads, 0)}
                        </td>
                        <td className="text-center text-purple-600">
                          {conversionData.reduce((sum, item) => sum + item.meetings, 0)}
                        </td>
                        <td className="text-center">
                          <span className="badge badge-info">
                            {results.length > 0 ? 
                              ((conversionData.reduce((sum, item) => sum + item.meetings, 0) / results.length) * 100).toFixed(1) 
                              : '0.0'}%
                          </span>
                        </td>
                        <td className="text-center text-orange-600">
                          {conversionData.reduce((sum, item) => sum + item.priceOffers, 0)}
                        </td>
                        <td className="text-center text-red-600">
                          {conversionData.reduce((sum, item) => sum + item.success, 0)}
                        </td>
                        <td className="text-center text-gray-800">
                          {formatCurrency(conversionData.reduce((sum, item) => sum + item.total, 0))}
                        </td>
                        <td className="text-center">
                          <span className="badge badge-primary">0.0%</span>
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* Key Insights */}
                <div className="mt-8 p-6 bg-gray-50 rounded-lg">
                  <h4 className="text-lg font-semibold mb-4">Key Performance Indicators</h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                    <div>
                      <span className="font-medium text-gray-600">Best Converting Category:</span>
                      <span className="ml-2 font-semibold">
                        {conversionData.length > 0 ? conversionData[0].category : 'N/A'}
                      </span>
                    </div>
                    <div>
                      <span className="font-medium text-gray-600">Average Cost per Lead:</span>
                      <span className="ml-2 font-semibold">
                        {results.length > 0 ? 
                          formatCurrency(conversionData.reduce((sum, item) => sum + item.total, 0) / results.length)
                          : '$0'}
                      </span>
                    </div>
                    <div>
                      <span className="font-medium text-gray-600">Overall Meeting Rate:</span>
                      <span className="ml-2 font-semibold">
                        {results.length > 0 ? 
                          ((conversionData.reduce((sum, item) => sum + item.meetings, 0) / results.length) * 100).toFixed(1)
                          : '0.0'}%
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center p-8 bg-base-200 rounded-lg">
              No leads found matching your criteria to analyze conversion rates.
            </div>
          )}
        </div>
      )}
    </div>
  );
};
const ConvertionStepsReport = () => {
  const [filters, setFilters] = useState({
    fromDate: '',
    toDate: '',
    source: '',
    category: '',
  });
  const [results, setResults] = useState<any>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchPerformed, setSearchPerformed] = useState(false);

  const sourceOptions = ["Facebook", "Google Ads", "Website", "Referral", "Email Campaign", "LinkedIn", "Instagram"];
  const categoryOptions = ["German Citizenship", "Austrian Citizenship", "Immigration to Israel"];

  const handleFilterChange = (field: string, value: any) => {
    setFilters(prev => ({ ...prev, [field]: value }));
  };

  const handleSearch = async () => {
    setIsSearching(true);
    setSearchPerformed(true);
    try {
      let query = supabase.from('leads').select('*');

      // Apply filters
      if (filters.fromDate) query = query.gte('created_at', filters.fromDate);
      if (filters.toDate) query = query.lte('created_at', filters.toDate);
      if (filters.source) query = query.ilike('source', `%${filters.source}%`);
      if (filters.category) query = query.ilike('category', `%${filters.category}%`);

      const { data, error } = await query.order('created_at', { ascending: false });

      if (error) throw error;

      // Process data for conversion steps
      const stageOrder = [
        'created',
        'scheduler_assigned', 
        'meeting_scheduled',
        'meeting_paid',
        'communication_started',
        'offer_sent',
        'client_signed'
      ];

      const conversionSteps = stageOrder.map((stage, index) => {
        const stageLeads = data?.filter(lead => {
          // For conversion analysis, we need to check if lead progressed to this stage or beyond
          const leadStageIndex = stageOrder.indexOf(lead.stage);
          return leadStageIndex >= index;
        }) || [];

        const previousStageLeads = index === 0 ? data : 
          data?.filter(lead => {
            const leadStageIndex = stageOrder.indexOf(lead.stage);
            return leadStageIndex >= (index - 1);
          }) || [];

        const conversionRate = previousStageLeads.length > 0 
          ? ((stageLeads.length / previousStageLeads.length) * 100).toFixed(1)
          : '0.0';

        return {
          stage: stage.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
          count: stageLeads.length,
          conversionRate: index === 0 ? '100.0' : conversionRate,
          dropOffCount: index === 0 ? 0 : previousStageLeads.length - stageLeads.length,
          dropOffRate: index === 0 ? '0.0' : (((previousStageLeads.length - stageLeads.length) / previousStageLeads.length) * 100).toFixed(1)
        };
      });

      setResults({
        totalLeads: data?.length || 0,
        conversionSteps,
        overallConversionRate: data?.length > 0 
          ? ((data.filter(lead => lead.stage === 'client_signed').length / data.length) * 100).toFixed(1)
          : '0.0'
      });
    } catch (error) {
      console.error('Error analyzing conversion steps:', error);
      alert('Failed to analyze conversion steps.');
      setResults(null);
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div>
      {/* Search Form */}
      <div className="card bg-base-200 shadow-lg p-6 mb-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="form-control">
            <label className="label"><span className="label-text">From date</span></label>
            <input 
              type="date" 
              className="input input-bordered" 
              value={filters.fromDate}
              onChange={e => handleFilterChange('fromDate', e.target.value)} 
            />
          </div>
          <div className="form-control">
            <label className="label"><span className="label-text">To date</span></label>
            <input 
              type="date" 
              className="input input-bordered" 
              value={filters.toDate}
              onChange={e => handleFilterChange('toDate', e.target.value)} 
            />
          </div>
          <div className="form-control">
            <label className="label"><span className="label-text">Source</span></label>
            <select 
              className="select select-bordered" 
              value={filters.source}
              onChange={e => handleFilterChange('source', e.target.value)}
            >
              <option value="">All Sources</option>
              {sourceOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          </div>
          <div className="form-control">
            <label className="label"><span className="label-text">Category</span></label>
            <select 
              className="select select-bordered" 
              value={filters.category}
              onChange={e => handleFilterChange('category', e.target.value)}
            >
              <option value="">All Categories</option>
              {categoryOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          </div>
        </div>
        <div className="mt-6">
          <button 
            className="btn btn-primary" 
            onClick={handleSearch}
            disabled={isSearching}
          >
            {isSearching ? 'Analyzing...' : 'Analyze Conversion Steps'}
          </button>
        </div>
      </div>

      {/* Results */}
      {searchPerformed && (
        <div>
          {isSearching ? (
            <div className="flex justify-center p-8">
              <span className="loading loading-spinner loading-lg"></span>
            </div>
          ) : results ? (
            <div className="space-y-6">
              {/* Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="card bg-gradient-to-br from-blue-500 via-blue-600 to-blue-700 text-white shadow-lg">
                  <div className="card-body">
                    <h3 className="text-lg font-semibold opacity-90">Total Leads</h3>
                    <p className="text-3xl font-bold">{results.totalLeads}</p>
                  </div>
                </div>
                <div className="card bg-gradient-to-br from-green-500 via-green-600 to-green-700 text-white shadow-lg">
                  <div className="card-body">
                    <h3 className="text-lg font-semibold opacity-90">Overall Conversion</h3>
                    <p className="text-3xl font-bold">{results.overallConversionRate}%</p>
                  </div>
                </div>
                <div className="card bg-gradient-to-br from-purple-500 via-purple-600 to-purple-700 text-white shadow-lg">
                  <div className="card-body">
                    <h3 className="text-lg font-semibold opacity-90">Conversion Steps</h3>
                    <p className="text-3xl font-bold">{results.conversionSteps.length}</p>
                  </div>
                </div>
              </div>

              {/* Conversion Funnel */}
              <div className="card bg-white shadow-lg">
                <div className="card-body">
                  <h3 className="text-xl font-bold mb-6">Conversion Funnel</h3>
                  <div className="overflow-x-auto">
                    <table className="table table-zebra w-full">
                      <thead>
                        <tr>
                          <th>Stage</th>
                          <th>Count</th>
                          <th>Conversion Rate</th>
                          <th>Drop-off Count</th>
                          <th>Drop-off Rate</th>
                        </tr>
                      </thead>
                      <tbody>
                        {results.conversionSteps.map((step: any, index: number) => (
                          <tr key={step.stage}>
                            <td className="font-semibold">{step.stage}</td>
                            <td>
                              <div className="flex items-center gap-2">
                                <span className="text-lg font-bold">{step.count}</span>
                                <div className="w-24 h-2 bg-gray-200 rounded-full">
                                  <div 
                                    className="h-2 bg-blue-500 rounded-full" 
                                    style={{ width: `${(step.count / results.totalLeads) * 100}%` }}
                                  ></div>
                                </div>
                              </div>
                            </td>
                            <td>
                              <span className={`badge ${parseFloat(step.conversionRate) >= 50 ? 'badge-success' : parseFloat(step.conversionRate) >= 25 ? 'badge-warning' : 'badge-error'}`}>
                                {step.conversionRate}%
                              </span>
                            </td>
                            <td>
                              {step.dropOffCount > 0 && (
                                <span className="text-red-600 font-medium">{step.dropOffCount}</span>
                              )}
                            </td>
                            <td>
                              {parseFloat(step.dropOffRate) > 0 && (
                                <span className={`badge ${parseFloat(step.dropOffRate) <= 25 ? 'badge-success' : parseFloat(step.dropOffRate) <= 50 ? 'badge-warning' : 'badge-error'}`}>
                                  {step.dropOffRate}%
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Visual Funnel */}
              <div className="card bg-white shadow-lg">
                <div className="card-body">
                  <h3 className="text-xl font-bold mb-6">Visual Funnel</h3>
                  <div className="flex flex-col items-center space-y-4">
                    {results.conversionSteps.map((step: any, index: number) => {
                      const width = Math.max(20, (step.count / results.totalLeads) * 100);
                      return (
                        <div key={step.stage} className="flex items-center w-full">
                          <div className="w-32 text-sm font-medium text-right pr-4">
                            {step.stage}
                          </div>
                          <div 
                            className="bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-lg flex items-center justify-center font-bold transition-all duration-300 hover:shadow-lg"
                            style={{ 
                              width: `${width}%`, 
                              height: '48px',
                              minWidth: '120px'
                            }}
                          >
                            {step.count} ({step.conversionRate}%)
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center p-8 bg-base-200 rounded-lg">
              No data found for conversion analysis.
            </div>
          )}
        </div>
      )}
    </div>
  );
};
const ScheduledReport = () => {
  const [filters, setFilters] = useState({
    fromDate: '',
    toDate: '',
  });
  const [results, setResults] = useState<any>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchPerformed, setSearchPerformed] = useState(false);

  const handleFilterChange = (field: string, value: any) => {
    setFilters(prev => ({ ...prev, [field]: value }));
  };

  const handleSearch = async () => {
    setIsSearching(true);
    setSearchPerformed(true);
    try {
      // Get all users first
      const { data: usersData, error: usersError } = await supabase
        .from('users')
        .select('email, full_name');
      if (usersError) throw usersError;

      console.log('Users data:', usersData);

      // Get meetings with date filters and join with leads
      let meetingsQuery = supabase
        .from('meetings')
        .select(`
          id,
          meeting_date,
          meeting_time,
          meeting_location,
          meeting_manager,
          scheduler,
          helper,
          expert,
          status,
          created_at,
          leads:client_id (
            id,
            lead_number,
            name,
            stage,
            status,
            scheduler,
            created_at
          )
        `);
      
      if (filters.fromDate) meetingsQuery = meetingsQuery.gte('meeting_date', filters.fromDate);
      if (filters.toDate) meetingsQuery = meetingsQuery.lte('meeting_date', filters.toDate);

      const { data: meetingsData, error: meetingsError } = await meetingsQuery.order('meeting_date', { ascending: false });
      if (meetingsError) throw meetingsError;

      console.log('Meetings data:', meetingsData);

      // Get leads data for stage analysis (filtered by date)
      let leadsQuery = supabase.from('leads').select(`
        id, 
        scheduler, 
        stage, 
        manager, 
        helper, 
        expert, 
        closer, 
        created_at,
        communication_started_by,
        communication_started_at,
        unactivated_by,
        unactivated_at,
        last_stage_changed_by,
        last_stage_changed_at
      `);
      if (filters.fromDate) leadsQuery = leadsQuery.gte('created_at', filters.fromDate);
      if (filters.toDate) leadsQuery = leadsQuery.lte('created_at', filters.toDate);

      const { data: leadsData, error: leadsError } = await leadsQuery.order('created_at', { ascending: false });
      if (leadsError) throw leadsError;

      console.log('Leads data:', leadsData);

      // Create a map of emails to full names
      const emailToNameMap = usersData?.reduce((acc: any, user: any) => {
        acc[user.email] = user.full_name || user.email;
        return acc;
      }, {}) || {};

      console.log('Email to name mapping:', emailToNameMap);

      // Initialize employee stats
      const employeeStats: any = {};

      // Helper function to initialize employee if not exists
      const initializeEmployee = (identifier: string) => {
        if (!employeeStats[identifier]) {
          employeeStats[identifier] = {
            fullName: emailToNameMap[identifier] || identifier,
            email: identifier,
            meetingsScheduled: 0,
            precommunication: 0,
            communicationStarted: 0,
            setAsUnactive: 0,
            total: 0
          };
        }
      };

      // 1. Count actual meetings scheduled (from meetings table)
      meetingsData?.forEach((meeting: any) => {
        const scheduler = meeting.scheduler;
        if (scheduler) {
          initializeEmployee(scheduler);
          employeeStats[scheduler].meetingsScheduled++;
          employeeStats[scheduler].total++;
        }
      });

      console.log('After processing meetings:', Object.keys(employeeStats).length, 'employees found');

      // 2. Count lead stages based on who performed each action
      leadsData?.forEach((lead: any) => {
        // Count precommunication: scheduler in created/scheduler_assigned stages
        if (lead.scheduler && (lead.stage === 'created' || lead.stage === 'scheduler_assigned')) {
          initializeEmployee(lead.scheduler);
          employeeStats[lead.scheduler].precommunication++;
          
          // Only count towards total if this lead doesn't have a scheduled meeting
          const hasScheduledMeeting = meetingsData?.some(m => m.leads?.id === lead.id);
          if (!hasScheduledMeeting) {
            employeeStats[lead.scheduler].total++;
          }
        }

        // Count communication started: user who moved to communication_started
        if (lead.communication_started_by) {
          initializeEmployee(lead.communication_started_by);
          employeeStats[lead.communication_started_by].communicationStarted++;
          
          // Count towards total if not already counted elsewhere
          const hasScheduledMeeting = meetingsData?.some(m => m.leads?.id === lead.id);
          const hasSchedulerAction = lead.scheduler && (lead.stage === 'created' || lead.stage === 'scheduler_assigned');
          if (!hasScheduledMeeting && !hasSchedulerAction) {
            employeeStats[lead.communication_started_by].total++;
          }
        }

        // Count unactivated: user who moved to unactivated/declined
        if (lead.unactivated_by) {
          initializeEmployee(lead.unactivated_by);
          employeeStats[lead.unactivated_by].setAsUnactive++;
          
          // Count towards total if not already counted elsewhere
          const hasScheduledMeeting = meetingsData?.some(m => m.leads?.id === lead.id);
          const hasSchedulerAction = lead.scheduler && (lead.stage === 'created' || lead.stage === 'scheduler_assigned');
          const hasCommunicationAction = lead.communication_started_by;
          if (!hasScheduledMeeting && !hasSchedulerAction && !hasCommunicationAction) {
            employeeStats[lead.unactivated_by].total++;
          }
        }
      });

      console.log('Employee stats:', employeeStats);

      // Convert to array and filter out employees with no activity
      const employeeArray = Object.entries(employeeStats)
        .map(([email, stats]: [string, any]) => ({ email, ...stats }))
        .filter(emp => emp.total > 0)
        .sort((a, b) => b.meetingsScheduled - a.meetingsScheduled);

      console.log('Employee array:', employeeArray);

      // Prepare chart data
      const chartData = employeeArray.map(emp => ({
        name: emp.fullName || emp.email,
        meetings: emp.meetingsScheduled
      }));

      console.log('Chart data:', chartData);

      setResults({
        employeeStats: employeeArray,
        chartData,
        totalMeetings: employeeArray.reduce((sum, emp) => sum + emp.meetingsScheduled, 0),
        totalEmployees: employeeArray.length,
        totalRecords: meetingsData?.length || 0,
        totalLeads: leadsData?.length || 0
      });

    } catch (error) {
      console.error('Error analyzing scheduled meetings:', error);
      alert('Failed to analyze scheduled meetings.');
      setResults(null);
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div>
      {/* Search Form */}
      <div className="card bg-base-200 shadow-lg p-6 mb-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="form-control">
            <label className="label"><span className="label-text">From date</span></label>
            <input 
              type="date" 
              className="input input-bordered" 
              value={filters.fromDate}
              onChange={e => handleFilterChange('fromDate', e.target.value)} 
            />
          </div>
          <div className="form-control">
            <label className="label"><span className="label-text">To date</span></label>
            <input 
              type="date" 
              className="input input-bordered" 
              value={filters.toDate}
              onChange={e => handleFilterChange('toDate', e.target.value)} 
            />
          </div>
        </div>
        <div className="mt-6">
          <button 
            className="btn btn-primary" 
            onClick={handleSearch}
            disabled={isSearching}
          >
            {isSearching ? 'Analyzing...' : 'Analyze Scheduled Meetings'}
          </button>
        </div>
      </div>

      {/* Results */}
      {searchPerformed && (
        <div>
          {isSearching ? (
            <div className="flex justify-center p-8">
              <span className="loading loading-spinner loading-lg"></span>
            </div>
          ) : results ? (
            <div className="space-y-6">
              {/* Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="card bg-gradient-to-br from-blue-500 via-blue-600 to-blue-700 text-white shadow-lg">
                  <div className="card-body">
                    <h3 className="text-lg font-semibold opacity-90">Total Meetings Scheduled</h3>
                    <p className="text-3xl font-bold">{results.totalMeetings}</p>
                  </div>
                </div>
                <div className="card bg-gradient-to-br from-green-500 via-green-600 to-green-700 text-white shadow-lg">
                  <div className="card-body">
                    <h3 className="text-lg font-semibold opacity-90">Active Employees</h3>
                    <p className="text-3xl font-bold">{results.totalEmployees}</p>
                  </div>
                </div>
                <div className="card bg-gradient-to-br from-purple-500 via-purple-600 to-purple-700 text-white shadow-lg">
                  <div className="card-body">
                    <h3 className="text-lg font-semibold opacity-90">Meeting Records</h3>
                    <p className="text-3xl font-bold">{results.totalRecords}</p>
                    <p className="text-sm opacity-80">From meetings table</p>
                  </div>
                </div>
                <div className="card bg-gradient-to-br from-orange-500 via-orange-600 to-orange-700 text-white shadow-lg">
                  <div className="card-body">
                    <h3 className="text-lg font-semibold opacity-90">Total Leads</h3>
                    <p className="text-3xl font-bold">{results.totalLeads}</p>
                    <p className="text-sm opacity-80">With schedulers assigned</p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Left Side - Graph */}
                <div className="card bg-white shadow-lg">
                  <div className="card-body">
                    <h3 className="text-xl font-bold mb-6">Meetings Scheduled by Employee</h3>
                    <div className="h-96">
                      {results.chartData.length > 0 ? (
                        <div className="space-y-3 h-full overflow-y-auto">
                          {results.chartData.map((item: any, index: number) => (
                            <div key={index} className="flex items-center gap-4">
                              <div className="w-32 text-sm font-medium text-right truncate">
                                {item.name}
                              </div>
                              <div className="flex-1 flex items-center gap-2">
                                <div className="flex-1 bg-gray-200 rounded-full h-6 relative">
                                  <div 
                                    className="bg-gradient-to-r from-blue-500 to-blue-600 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold transition-all duration-300"
                                    style={{ 
                                      width: `${Math.max(15, (item.meetings / Math.max(...results.chartData.map((d: any) => d.meetings))) * 100)}%` 
                                    }}
                                  >
                                    {item.meetings}
                                  </div>
                                </div>
                                <span className="text-sm font-bold text-gray-600 w-8">
                                  {item.meetings}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="flex items-center justify-center h-full text-gray-500">
                          No data available
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right Side - Table */}
                <div className="card bg-white shadow-lg">
                  <div className="card-body">
                    <h3 className="text-xl font-bold mb-6">Employee Performance Details</h3>
                    <div className="overflow-x-auto h-96">
                      <table className="table table-zebra table-pin-rows w-full text-sm">
                        <thead>
                          <tr>
                            <th className="text-xs">Employee</th>
                            <th className="text-xs">Meetings Scheduled</th>
                            <th className="text-xs">Precommunication</th>
                            <th className="text-xs">Communication Started</th>
                            <th className="text-xs">Set as Unactive</th>
                            <th className="text-xs">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {results.employeeStats.map((emp: any, index: number) => (
                            <tr key={index}>
                              <td className="font-medium">
                                <div className="flex flex-col">
                                  <span className="text-xs text-gray-600">{emp.email}</span>
                                  <span className="font-semibold">{emp.fullName}</span>
                                </div>
                              </td>
                              <td>
                                <span className="badge badge-primary badge-sm">
                                  {emp.meetingsScheduled}
                                </span>
                              </td>
                              <td>
                                <span className="badge badge-warning badge-sm">
                                  {emp.precommunication}
                                </span>
                              </td>
                              <td>
                                <span className="badge badge-success badge-sm">
                                  {emp.communicationStarted}
                                </span>
                              </td>
                              <td>
                                <span className="badge badge-error badge-sm">
                                  {emp.setAsUnactive}
                                </span>
                              </td>
                              <td>
                                <span className="badge badge-neutral badge-sm">
                                  {emp.total}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center p-8 bg-base-200 rounded-lg">
              No data found for scheduled meetings analysis.
            </div>
          )}
        </div>
      )}
    </div>
  );
};
const RescheduledReport = () => <div className="p-6">Rescheduled Meetings Report Content</div>;
const ResultsReport = () => <div className="p-6">Results Report Content</div>;
const CollectionReport = () => <div className="p-6">Collection Report Content</div>;
const ActualReport = () => <div className="p-6">Actual Sales Report Content</div>;
const TargetReport = () => <div className="p-6">Target Sales Report Content</div>;
const SignedReport = () => <div className="p-6">Signed Sales Report Content</div>;
const SchedulingBonusesReport = () => <div className="p-6">Scheduling Bonuses Report Content</div>;
const BonusesV4Report = () => <div className="p-6">Bonuses (v4) Report Content</div>;
const GeneralSalesReport = () => <div className="p-6">General Sales Pipeline Report Content</div>;
const EmployeeReport = () => <div className="p-6">Employee Pipeline Report Content</div>;
const UnhandledReport = () => <div className="p-6">Unhandled Pipeline Report Content</div>;
const ExpertReport = () => <div className="p-6">Expert Pipeline Report Content</div>;
const SuperPipelineSchedulersReport = () => <div className="p-6">Super Pipeline (Schedulers) Report Content</div>;
const SchedulersQualityReport = () => <div className="p-6">Schedulers Quality Report Content</div>;
const PerformanceReport = () => <div className="p-6">Schedulers Performance Report Content</div>;
const PerformanceByCatReport = () => <div className="p-6">Schedulers Performance by Cat. Report Content</div>;
const SuperPipelineClosersReport = () => <div className="p-6">Super Pipeline (Closers) Report Content</div>;
const ClosersQualityReport = () => <div className="p-6">Closers Quality Report Content</div>;
const ExpertsAssignmentReport = () => <div className="p-6">Experts Assignment Report Content</div>;
const ExpertsResultsReport = () => <div className="p-6">Experts Results Report Content</div>;
const EmployeesPerformanceReport = () => <div className="p-6">Employees Performance Analysis Content</div>;
const StatisticsReport = () => <div className="p-6">Statistics Analysis Content</div>;
const PiesReport = () => <div className="p-6">Pies Analysis Content</div>;
const TasksReport = () => <div className="p-6">Tasks Analysis Content</div>;
const ProfitabilityReport = () => <div className="p-6">Profitability Finances Content</div>;
const CollectionDueReport = () => <div className="p-6">Collection Due Finances Content</div>;
const SumActiveReport = () => <div className="p-6">Sum Active Cases Content</div>;

const reports = [
  {
    category: 'Search',
    items: [
      { label: 'Full Search', icon: MagnifyingGlassIcon, component: FullSearchReport },
      { label: 'Stage Search', icon: Squares2X2Icon, component: StageSearchReport },
      { label: 'Anchor Search', icon: ArrowUturnDownIcon, component: AnchorSearchReport },
      { label: 'Duplicate Search', icon: DocumentDuplicateIcon, component: DuplicateSearchReport },
    ],
  },
  {
    category: 'Marketing',
    items: [
      { label: 'Sources pie', icon: ChartPieIcon, component: SourcesPieReport },
      { label: 'Category & source', icon: AdjustmentsHorizontalIcon, component: CategorySourceReport },
      { label: 'Convertion', icon: FunnelIcon, component: ConvertionReport },
      { label: 'Convertion Steps', icon: FunnelIcon, component: ConvertionStepsReport },
    ],
  },
  {
    category: 'Meetings',
    items: [
      { label: 'Scheduled', icon: ClockIcon, component: ScheduledReport },
      { label: 'Rescheduled', icon: ArrowPathIcon, component: RescheduledReport },
      { label: 'Results', icon: CheckCircleIcon, component: ResultsReport },
      { label: 'Collection', icon: BanknotesIcon, component: CollectionReport },
      { label: 'Convertion', icon: FunnelIcon, component: ConvertionReport },
    ],
  },
  {
    category: 'Sales',
    items: [
      { label: 'Actual', icon: UserGroupIcon, component: ActualReport },
      { label: 'Target', icon: UserIcon, component: TargetReport },
      { label: 'Signed', icon: AcademicCapIcon, component: SignedReport },
      { label: 'Scheduling Bonuses', icon: StarIcon, component: SchedulingBonusesReport },
      { label: 'Bonuses (v4)', icon: PlusIcon, component: BonusesV4Report },
    ],
  },
  {
    category: 'Pipelines',
    items: [
      { label: 'General Sales', icon: Squares2X2Icon, component: GeneralSalesReport },
      { label: 'Employee', icon: UserIcon, component: EmployeeReport },
      { label: 'Unhandled', icon: UserIcon, component: UnhandledReport },
      { label: 'Expert', icon: AcademicCapIcon, component: ExpertReport },
    ],
  },
  {
    category: 'Schedulers',
    items: [
      { label: 'Super Pipeline', icon: BanknotesIcon, component: SuperPipelineSchedulersReport },
      { label: 'Schedulers Quality', icon: StarIcon, component: SchedulersQualityReport },
      { label: 'Performance', icon: ChartBarIcon, component: PerformanceReport },
      { label: 'Performance by Cat.', icon: ChartBarIcon, component: PerformanceByCatReport },
    ],
  },
  {
    category: 'Closers',
    items: [
      { label: 'Super Pipeline', icon: BanknotesIcon, component: SuperPipelineClosersReport },
      { label: 'Closers Quality', icon: StarIcon, component: ClosersQualityReport },
    ],
  },
  {
    category: 'Experts',
    items: [
      { label: 'Experts Assignment', icon: AcademicCapIcon, component: ExpertsAssignmentReport },
      { label: 'Experts Results', icon: AcademicCapIcon, component: ExpertsResultsReport },
    ],
  },
  {
    category: 'Analysis',
    items: [
      { label: 'Employees Performance', icon: ChartBarIcon, component: EmployeesPerformanceReport },
      { label: 'Statistics', icon: ChartPieIcon, component: StatisticsReport },
      { label: 'Pies', icon: ChartPieIcon, component: PiesReport },
      { label: 'Tasks', icon: ListBulletIcon, component: TasksReport },
    ],
  },
  {
    category: 'Finances',
    items: [
      { label: 'Profitability', icon: CurrencyDollarIcon, component: ProfitabilityReport },
      { label: 'Collection', icon: BanknotesIcon, component: CollectionReport },
      { label: 'Collection Due', icon: BanknotesIcon, component: CollectionDueReport },
    ],
  },
  {
    category: 'Cases',
    items: [
      { label: 'Sum Active', icon: BriefcaseIcon, component: SumActiveReport },
    ],
  },
];

export default function ReportsPage() {
  const [selectedReport, setSelectedReport] = useState<null | { label: string; component: React.FC }>(null);

  console.log('Selected report:', selectedReport);

  return (
    <div className="p-0 md:p-6 space-y-8">
      {!selectedReport ? (
        <>
          <h1 className="text-4xl font-bold mb-8 px-4 md:px-0">Reports</h1>
          <div className="space-y-10 px-4 md:px-0">
            {reports.map((section) => (
              <div key={section.category}>
                <h2 className="text-2xl font-semibold mb-4">{section.category}</h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6">
                  {section.items.map((item) => (
                    <button
                      key={item.label}
                      className="card bg-base-100 shadow hover:shadow-lg transition-shadow border border-base-200 flex flex-col items-center justify-center p-6 cursor-pointer hover:bg-primary hover:text-white group"
                      onClick={() => setSelectedReport(item)}
                    >
                      <item.icon className="w-12 h-12 mb-3 text-black group-hover:text-white" />
                      <span className="font-semibold text-lg text-center group-hover:text-white">{item.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="px-4 md:px-0">
          {/* Report Content */}
          <div className="bg-white rounded-xl shadow-lg p-8 border border-base-200">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-2xl font-bold">{selectedReport.label}</h3>
              <button
                onClick={() => setSelectedReport(null)}
                className="btn btn-outline btn-primary flex items-center gap-2"
              >
                <ArrowLeftIcon className="w-5 h-5" />
                Back to Reports
              </button>
            </div>
            <div className="min-h-[400px]">
              {React.createElement(selectedReport.component)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
} 