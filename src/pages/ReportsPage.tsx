import React, { useMemo, useState } from 'react';
import { MagnifyingGlassIcon, Squares2X2Icon, ArrowUturnDownIcon, DocumentDuplicateIcon, ChartPieIcon, AdjustmentsHorizontalIcon, FunnelIcon, ClockIcon, ArrowPathIcon, CheckCircleIcon, BanknotesIcon, UserGroupIcon, UserIcon, AcademicCapIcon, StarIcon, PlusIcon, ClipboardDocumentCheckIcon, ChartBarIcon, ListBulletIcon, CurrencyDollarIcon, BriefcaseIcon, ArrowLeftIcon } from '@heroicons/react/24/solid';
import FullSearchReport from './FullSearchReport';
import { supabase } from '../lib/supabase';
import EmployeeLeadDrawer, {
  EmployeeLeadDrawerItem,
  LeadBaseDetail,
} from '../components/reports/EmployeeLeadDrawer';
import { useNavigate } from 'react-router-dom';

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
        
        <p className="text-sm text-base-content/600 font-mono mb-4">#{lead.lead_number}</p>

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
        
        <p className="text-sm text-base-content/600 font-mono mb-4">#{lead.lead_number}</p>

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
      <div className="bg-white mb-8">
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
        
        <p className="text-sm text-base-content/600 font-mono mb-2">#{lead.lead_number}</p>
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
      
      const processedSourceDataArray = Object.entries(sourceCounts).map(([source, count]) => ({
        source,
        count,
        percentage: total > 0 ? ((count as number / total) * 100).toFixed(1) : '0.0',
        link: sourceLinks[source as keyof typeof sourceLinks] || 'https://lawoffice.org.il/unknown-source'
      })) as Array<{ source: string; count: number; percentage: string; link: string }>;

      processedSourceDataArray.sort((a, b) => b.count - a.count);

      setSourceData(processedSourceDataArray);
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
                            <span className="font-semibold text-gray-800">{item.count}</span>
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
      })) as Array<{ stage: string; originalStage: string; total: number; priority: number }>;

      processedStageData.sort((a, b) => {
        // First sort by priority (higher priority = more advanced stage)
        if (a.priority !== b.priority) {
          return b.priority - a.priority;
        }
        // If same priority, sort by count
        return (b.total ?? 0) - (a.total ?? 0);
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
            <label className="label mb-2"><span className="label-text">From Meeting Date</span></label>
            <input 
              type="date" 
              className="input input-bordered" 
              onChange={e => handleFilterChange('fromDate', e.target.value)} 
            />
          </div>
          <div className="form-control">
            <label className="label mb-2"><span className="label-text">To Meeting Date</span></label>
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
                <div className="card shadow-lg border-0 text-white" style={{ backgroundColor: '#4218CC' }}>
                  <div className="card-body text-center">
                    <h3 className="text-lg font-semibold text-blue-100">Total Leads</h3>
                    <p className="text-3xl font-bold text-white">{results.length}</p>
                  </div>
                </div>
                <div className="card shadow-lg border-0 text-white" style={{ backgroundColor: '#4218CC' }}>
                  <div className="card-body text-center">
                    <h3 className="text-lg font-semibold text-green-100">Total Meetings</h3>
                    <p className="text-3xl font-bold text-white">
                      {conversionData.reduce((sum, item) => sum + item.meetings, 0)}
                    </p>
                  </div>
                </div>
                <div className="card shadow-lg border-0 text-white" style={{ backgroundColor: '#4218CC' }}>
                  <div className="card-body text-center">
                    <h3 className="text-lg font-semibold text-purple-100">Price Offers</h3>
                    <p className="text-3xl font-bold text-white">
                      {conversionData.reduce((sum, item) => sum + item.priceOffers, 0)}
                    </p>
                  </div>
                </div>
                <div className="card shadow-lg border-0 text-white" style={{ backgroundColor: '#4218CC' }}>
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
                            <span className="text-sm font-semibold text-blue-600">{item.meetingRate}</span>
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
                          <td className="text-center text-indigo-600 font-semibold">
                              {item.rate}
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
                        <td className="text-center text-blue-600 font-semibold">
                            {results.length > 0 ? 
                              ((conversionData.reduce((sum, item) => sum + item.meetings, 0) / results.length) * 100).toFixed(1) 
                              : '0.0'}%
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
                        <td className="text-center text-indigo-600 font-semibold">0.0%</td>
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
      <div className="bg-white mb-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="form-control">
            <label className="label"><span className="label-text">From Meeting Date</span></label>
            <input 
              type="date" 
              className="input input-bordered" 
              value={filters.fromDate}
              onChange={e => handleFilterChange('fromDate', e.target.value)} 
            />
          </div>
          <div className="form-control">
            <label className="label"><span className="label-text">To Meeting Date</span></label>
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
                    <table className="table w-full">
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
type EmployeeLeadBuckets = {
  meetingScheduled: string[];
  precommunication: string[];
  communicationStarted: string[];
  setAsUnactive: string[];
};

type EmployeeMetricKey = keyof EmployeeLeadBuckets | 'total';

const ScheduledReport = () => {
  const today = useMemo(() => new Date().toISOString().split('T')[0], []);
  const [filters, setFilters] = useState({
    fromDate: today,
    toDate: today,
  });
  const [results, setResults] = useState<any>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchPerformed, setSearchPerformed] = useState(false);
  const [drawerState, setDrawerState] = useState<{
    isOpen: boolean;
    title: string;
    leads: EmployeeLeadDrawerItem[];
  }>({
    isOpen: false,
    title: '',
    leads: [],
  });

  const metricLabels: Record<EmployeeMetricKey, string> = {
    meetingScheduled: 'Meetings Scheduled',
    precommunication: 'Precommunication',
    communicationStarted: 'Communication Started',
    setAsUnactive: 'Set As Unactive',
    total: 'Total',
  };

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
        .select(`
          email,
          full_name,
          employee_id,
          tenants_employee!employee_id (
            id,
            display_name
          )
        `);
      if (usersError) throw usersError;

      console.log('Users data:', usersData);

      // Fetch employee records for ID/display name mapping
      const { data: employeesData, error: employeesError } = await supabase
        .from('tenants_employee')
        .select('id, display_name');
      if (employeesError) throw employeesError;

      const employeeIdToName: Record<string, string> = {};
      const displayNameToId: Record<string, string> = {};
      const emailToEmployeeId: Record<string, string> = {};

      employeesData?.forEach((emp: any) => {
        if (emp?.id === null || emp?.id === undefined) return;
        const idStr = emp.id.toString();
        const displayName = (emp.display_name || '').trim();
        if (displayName && !displayName.includes('@')) {
          employeeIdToName[idStr] = displayName;
          displayNameToId[displayName] = idStr;
        }
      });

      usersData?.forEach((user: any) => {
        const employeeRelation = Array.isArray(user.tenants_employee)
          ? user.tenants_employee[0]
          : user.tenants_employee;

        const employeeId = user.employee_id ?? employeeRelation?.id;
        if (employeeId !== undefined && employeeId !== null) {
          const idStr = employeeId.toString();
          const displayName = (
            employeeRelation?.display_name ||
            employeeIdToName[idStr] ||
            user.full_name ||
            ''
          ).trim();

          if (displayName && !displayName.includes('@')) {
            employeeIdToName[idStr] = displayName;
            displayNameToId[displayName] = idStr;
            if (user.email) {
              emailToEmployeeId[user.email.toLowerCase()] = idStr;
            }
          }
        }
      });

      const { data: stageDefinitions, error: stageDefinitionsError } = await supabase
        .from('lead_stages')
        .select('id, name');
      if (stageDefinitionsError) throw stageDefinitionsError;

      const normalizeStageName = (value?: string | null) =>
        value ? value.toLowerCase().replace(/[\s_-]/g, '') : '';

      const stageIdToNormalizedName: Record<number, string> = {};
      stageDefinitions?.forEach(def => {
        if (def?.id !== null && def?.id !== undefined) {
          stageIdToNormalizedName[Number(def.id)] = normalizeStageName(def.name);
        }
      });

      const collectStageIds = (targetName: string, fallbacks: number[]) => {
        const ids = new Set<number>();
        const normalizedTarget = normalizeStageName(targetName);
        stageDefinitions
          ?.filter(def => normalizeStageName(def.name) === normalizedTarget)
          ?.forEach(def => {
            if (def?.id !== null && def?.id !== undefined) {
              ids.add(Number(def.id));
            }
          });
        fallbacks.forEach(num => {
          if (Number.isFinite(num)) {
            ids.add(Number(num));
          }
        });
        return Array.from(ids);
      };

      const precommunicationStageIds = collectStageIds('Precommunication', [11, 0]);
      const communicationStartedStageIds = collectStageIds('Communication Started', [15]);
      const setAsUnactiveStageIds = collectStageIds('Set As Unactive', [91]);
      const meetingScheduledStageIds = collectStageIds('Meeting Scheduled', [20]);
      console.log('🔍 Scheduled Report - stage ID collections:', {
        precommunicationStageIds,
        communicationStartedStageIds,
        setAsUnactiveStageIds,
        meetingScheduledStageIds,
      });

      const precommunicationStageIdSet = new Set(precommunicationStageIds.map(id => Number(id)));
      const communicationStartedStageIdSet = new Set(
        communicationStartedStageIds.map(id => Number(id))
      );
      const setAsUnactiveStageIdSet = new Set(setAsUnactiveStageIds.map(id => Number(id)));
      const meetingScheduledStageIdSet = new Set(meetingScheduledStageIds.map(id => Number(id)));

      const precommunicationStageNameSet = new Set<string>(['precommunication']);
      precommunicationStageIds.forEach(id => {
        const name = stageIdToNormalizedName[Number(id)];
        if (name) precommunicationStageNameSet.add(name);
      });

      const communicationStartedStageNameSet = new Set<string>([
        'communicationstarted',
        'communicationstart',
      ]);
      communicationStartedStageIds.forEach(id => {
        const name = stageIdToNormalizedName[Number(id)];
        if (name) communicationStartedStageNameSet.add(name);
      });

      const setAsUnactiveStageNameSet = new Set<string>([
        'setasunactive',
        'setasuninvolved',
        'unactivated',
      ]);
      setAsUnactiveStageIds.forEach(id => {
        const name = stageIdToNormalizedName[Number(id)];
        if (name) setAsUnactiveStageNameSet.add(name);
      });

      const meetingScheduledStageNameSet = new Set<string>(['meetingscheduled']);
      meetingScheduledStageIds.forEach(id => {
        const name = stageIdToNormalizedName[Number(id)];
        if (name) meetingScheduledStageNameSet.add(name);
      });

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
          meeting_currency,
          meeting_amount,
          client_id,
          legacy_lead_id,
          lead:leads!client_id (
            id,
            lead_number,
            name,
            stage,
            status,
            scheduler,
            created_at,
            category,
            category_id,
            misc_category!category_id (
              id,
              name,
              misc_maincategory!parent_id (
                id,
                name
              )
            )
          ),
          legacy_lead:leads_lead!legacy_lead_id (
            id,
            name,
            stage,
            status,
            meeting_scheduler_id,
            meeting_manager_id,
            meeting_lawyer_id,
            category,
            category_id,
            total,
            currency_id,
            misc_category!category_id (
              id,
              name,
              misc_maincategory!parent_id (
                id,
                name
              )
            )
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
        lead_number,
        name,
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
        stage_changed_by,
        stage_changed_at,
        category,
        category_id,
        misc_category!category_id (
          id,
          name,
          misc_maincategory!parent_id (
            id,
            name
          )
        )
      `);
      if (filters.fromDate) leadsQuery = leadsQuery.gte('created_at', filters.fromDate);
      if (filters.toDate) leadsQuery = leadsQuery.lte('created_at', filters.toDate);

      const { data: leadsData, error: leadsError } = await leadsQuery.order('created_at', { ascending: false });
      if (leadsError) throw leadsError;

      console.log('Leads data:', leadsData);

      const chunkArray = <T,>(items: T[], size: number): T[][] => {
        const chunks: T[][] = [];
        for (let i = 0; i < items.length; i += size) {
          chunks.push(items.slice(i, i + size));
        }
        return chunks;
      };

      const stageHistoryStageIds = Array.from(
        new Set([
          ...precommunicationStageIds,
          ...communicationStartedStageIds,
          ...setAsUnactiveStageIds,
          ...meetingScheduledStageIds,
        ])
      ).filter(id => id !== null && id !== undefined);

      let stageHistoryData: any[] = [];
      const newLeadIdsSet = new Set<string>();
      const legacyLeadIdsSet = new Set<string>();
      console.log('🔍 Scheduled Report - stage history stage IDs used in query:', stageHistoryStageIds);

      if (stageHistoryStageIds.length > 0) {
        let stageHistoryQuery = supabase
          .from('leads_leadstage')
          .select('id, stage, cdate, creator_id, lead_id, newlead_id');
        stageHistoryQuery = stageHistoryQuery.in('stage', stageHistoryStageIds.map(id => Number(id)));

        if (filters.fromDate) {
          console.log('🔍 Scheduled Report - applying fromDate filter (cdate >=):', `${filters.fromDate}T00:00:00`);
          stageHistoryQuery = stageHistoryQuery.gte('cdate', `${filters.fromDate}T00:00:00`);
        }
        if (filters.toDate) {
          console.log('🔍 Scheduled Report - applying toDate filter (cdate <=):', `${filters.toDate}T23:59:59`);
          stageHistoryQuery = stageHistoryQuery.lte('cdate', `${filters.toDate}T23:59:59`);
        }

        const { data: stageHistoryRaw, error: stageHistoryError } = await stageHistoryQuery;
        if (stageHistoryError) throw stageHistoryError;
        stageHistoryData =
          stageHistoryRaw?.filter((entry: any) => {
            const stageIdNum = Number(entry.stage);
            const normalizedName = stageIdToNormalizedName[stageIdNum] || normalizeStageName(entry.stage?.toString());
            return (
              precommunicationStageIdSet.has(stageIdNum) ||
              communicationStartedStageIdSet.has(stageIdNum) ||
              setAsUnactiveStageIdSet.has(stageIdNum) ||
              meetingScheduledStageIdSet.has(stageIdNum) ||
              precommunicationStageNameSet.has(normalizedName) ||
              communicationStartedStageNameSet.has(normalizedName) ||
              setAsUnactiveStageNameSet.has(normalizedName) ||
              meetingScheduledStageNameSet.has(normalizedName)
            );
          }) || [];

        stageHistoryData.forEach((entry: any) => {
          if (entry.newlead_id) {
            newLeadIdsSet.add(entry.newlead_id.toString());
          }
          if (entry.lead_id !== null && entry.lead_id !== undefined) {
            legacyLeadIdsSet.add(entry.lead_id.toString());
          }
        });
      }
    console.log('🔍 Scheduled Report - stage history count:', stageHistoryData.length);
    console.log('🔍 Scheduled Report - stage history sample:', stageHistoryData.slice(0, 10));
      console.log(
        '🔍 Scheduled Report - stage history distinct stages:',
        Array.from(new Set(stageHistoryData.map((entry: any) => entry.stage)))
      );
    const stageBucketSummary = stageHistoryData.reduce(
      (acc: Record<string, { count: number; creators: Set<string> }>, entry: any) => {
        const key = String(entry.stage ?? 'null');
        if (!acc[key]) {
          acc[key] = { count: 0, creators: new Set<string>() };
        }
        acc[key].count += 1;
        if (entry.creator_id !== null && entry.creator_id !== undefined) {
          acc[key].creators.add(String(entry.creator_id));
        }
        return acc;
      },
      {}
    );
    console.log(
      '🔍 Scheduled Report - stage bucket summary:',
      Object.fromEntries(
        Object.entries(stageBucketSummary).map(([stage, info]) => [
          stage,
          { count: info.count, creators: Array.from(info.creators).slice(0, 10) },
        ])
      )
    );
      const precommunicationSamples = stageHistoryData
        .filter((entry: any) => Number(entry.stage) === 0 || Number(entry.stage) === 11)
        .slice(0, 5);
      const meetingScheduledSamples = stageHistoryData
        .filter((entry: any) => Number(entry.stage) === 20)
        .slice(0, 5);
      console.log('🔍 Scheduled Report - stage 0 sample:', precommunicationSamples);
      console.log('🔍 Scheduled Report - stage 50 sample:', meetingScheduledSamples);

      const newLeadMap = new Map<string, any>();
      const legacyLeadMap = new Map<string, any>();
      const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
      const hydrateLeadMaps = async () => {
        newLeadMap.clear();
        legacyLeadMap.clear();

        const newLeadIds = Array.from(newLeadIdsSet);
        const legacyLeadIds = Array.from(legacyLeadIdsSet);
        console.log('🔍 Scheduled Report - new leads to hydrate:', newLeadIds.length);
        console.log('🔍 Scheduled Report - legacy leads to hydrate:', legacyLeadIds.length);

        (leadsData as any[])?.forEach((lead: any) => {
          if (lead?.id) {
            newLeadMap.set(lead.id.toString(), lead);
          }
        });

        for (const chunk of chunkArray(newLeadIds, 200)) {
          const validUuidChunk = chunk.filter(id => {
            if (!uuidRegex.test(id)) {
              console.warn('🔍 Scheduled Report - skipping invalid new lead UUID:', id);
              return false;
            }
            return true;
          });
          if (validUuidChunk.length === 0) continue;
          const { data, error } = await supabase
            .from('leads')
            .select(`
              id,
              lead_number,
              name,
              scheduler,
              manager,
              category,
              category_id,
              misc_category!category_id(
                id,
                name,
                misc_maincategory!parent_id(
                  id,
                  name
                )
              )
            `)
            .in('id', validUuidChunk);
          if (error) throw error;
          data?.forEach((lead: any) => {
            if (lead?.id !== undefined && lead?.id !== null) {
              newLeadMap.set(lead.id.toString(), lead);
            }
          });
        }

        for (const chunk of chunkArray(legacyLeadIds, 200)) {
          const numericChunk = chunk
            .map(id => {
              const num = Number(id);
              if (!Number.isFinite(num) || Number.isNaN(num)) {
                console.warn('🔍 Scheduled Report - skipping invalid legacy lead ID:', id);
                return null;
              }
              return num;
            })
            .filter((id): id is number => id !== null);
          if (numericChunk.length === 0) continue;
          const { data, error } = await supabase
            .from('leads_lead')
            .select(`
              id,
              manual_id,
              lead_number,
              name,
              meeting_scheduler_id,
              meeting_manager_id,
              category,
              category_id,
              misc_category!category_id(
                id,
                name,
                misc_maincategory!parent_id(
                  id,
                  name
                )
              )
            `)
            .in('id', numericChunk);
          if (error) throw error;
          data?.forEach((lead: any) => {
            if (lead?.id !== undefined && lead?.id !== null) {
              legacyLeadMap.set(lead.id.toString(), lead);
            }
          });
        }
      };

      const normalizeIdentifier = (raw: any): { key: string; displayName: string } | null => {
        if (raw === null || raw === undefined) return null;
        const value = raw.toString().trim();
        if (!value) return null;

        const numericId = Number(value);
        if (!isNaN(numericId) && employeeIdToName[value]) {
          return { key: value, displayName: employeeIdToName[value] };
        }

        if (displayNameToId[value]) {
          const employeeId = displayNameToId[value];
          const displayName = employeeIdToName[employeeId];
          if (displayName) {
            return { key: employeeId, displayName };
          }
        }

        const lower = value.toLowerCase();
        if (emailToEmployeeId[lower]) {
          const employeeId = emailToEmployeeId[lower];
          const displayName = employeeIdToName[employeeId];
          if (displayName) {
            return { key: employeeId, displayName };
          }
        }

        return null;
      };

      // Initialize employee stats
      const employeeStats: any = {};

      const parseLeadKey = (leadKey: string): { type: 'new' | 'legacy'; id: string } | null => {
        if (leadKey.startsWith('new-')) {
          return { type: 'new', id: leadKey.slice(4) };
        }
        if (leadKey.startsWith('legacy-')) {
          return { type: 'legacy', id: leadKey.slice(7) };
        }
        return null;
      };

      const meetingScheduledLeadSet = new Set<string>();
      let totalMeetingEvents = 0;
      const schedulerStageStats: Record<string, { leads: Set<string>; eventCount: number }> = {};

      const stageLeadSets: Record<
        string,
        {
          precommunication: Set<string>;
          communicationStarted: Set<string>;
          setAsUnactive: Set<string>;
          meetingScheduled: Set<string>;
        }
      > = {};
      const meetingStageEntries: Array<{ leadKey: string; fallbackIdentifier: string | number | null }> = [];
      const deferredStageAssignments: Array<{
        stageType: 'precommunication' | 'communicationStarted' | 'setAsUnactive';
        leadKey: string;
        fallbackIdentifier: string | number | null;
      }> = [];

      const ensureStageLeadSets = (identifier: string) => {
        if (!stageLeadSets[identifier]) {
          stageLeadSets[identifier] = {
            precommunication: new Set<string>(),
            communicationStarted: new Set<string>(),
            setAsUnactive: new Set<string>(),
            meetingScheduled: new Set<string>(),
          };
        }
        if (!schedulerStageStats[identifier]) {
          schedulerStageStats[identifier] = { leads: new Set<string>(), eventCount: 0 };
        }
      };

      // Helper function to initialize employee if not exists
      const initializeEmployee = (identifier: string) => {
        if (!identifier) return;
        const displayName = employeeIdToName[identifier];
        if (!displayName || displayName.includes('@')) return;
        if (!employeeStats[identifier]) {
          employeeStats[identifier] = {
            id: identifier,
            fullName: displayName,
            meetingsScheduled: 0,
            precommunication: 0,
            communicationStarted: 0,
            setAsUnactive: 0,
            total: 0
          };
        }
        ensureStageLeadSets(identifier);
      };

      const recordMeetingForScheduler = (schedulerKey: string, leadKey: string) => {
        if (!schedulerKey || !leadKey) return;
        initializeEmployee(schedulerKey);
        if (!employeeStats[schedulerKey]) return;
        ensureStageLeadSets(schedulerKey);

        schedulerStageStats[schedulerKey].leads.add(leadKey);
        schedulerStageStats[schedulerKey].eventCount += 1;
        meetingScheduledLeadSet.add(leadKey);
        totalMeetingEvents += 1;
      };

      console.log('After processing meetings:', Object.keys(employeeStats).length, 'employees found');

      const globalStageLeadSet = new Set<string>();
      const ensureLeadTracked = (leadKey: string) => {
        const parsed = parseLeadKey(leadKey);
        if (!parsed || !parsed.id) return;
        if (parsed.type === 'new') {
          newLeadIdsSet.add(parsed.id);
        } else if (parsed.type === 'legacy') {
          legacyLeadIdsSet.add(parsed.id);
        }
      };

      stageHistoryData.forEach(entry => {
        const stageId = Number(entry.stage);
        const normalizedStageName = stageIdToNormalizedName[stageId] || '';
        if (stageId === 20 || normalizedStageName === 'meetingscheduled') {
          console.log('🔍 Stage entry hitting meeting-scheduled bucket candidate:', entry);
        }
        if (stageId === 11 || normalizedStageName === 'precommunication') {
          console.log('🔍 Stage entry hitting precommunication candidate:', entry);
        }

        const stageNormalizedName = stageIdToNormalizedName[stageId] || '';

        let stageType:
          | 'precommunication'
          | 'communicationStarted'
          | 'setAsUnactive'
          | 'meetingScheduled'
          | null = null;
        if (
          precommunicationStageIdSet.has(stageId) ||
          precommunicationStageNameSet.has(stageNormalizedName)
        ) {
          stageType = 'precommunication';
        } else if (
          communicationStartedStageIdSet.has(stageId) ||
          communicationStartedStageNameSet.has(stageNormalizedName)
        ) {
          stageType = 'communicationStarted';
        } else if (
          setAsUnactiveStageIdSet.has(stageId) ||
          setAsUnactiveStageNameSet.has(stageNormalizedName)
        ) {
          stageType = 'setAsUnactive';
        } else if (
          meetingScheduledStageIdSet.has(stageId) ||
          meetingScheduledStageNameSet.has(stageNormalizedName)
        ) {
          stageType = 'meetingScheduled';
        }

        if (!stageType) return;

        let leadKey: string | null = null;
        if (entry.newlead_id) {
          leadKey = `new-${entry.newlead_id.toString()}`;
        } else if (entry.lead_id !== null && entry.lead_id !== undefined) {
          leadKey = `legacy-${entry.lead_id.toString()}`;
        }
        if (!leadKey) return;

        const leadIdentifierKey = leadKey!;
        ensureLeadTracked(leadIdentifierKey);

        if (stageType === 'meetingScheduled') {
          meetingStageEntries.push({
            leadKey: leadIdentifierKey,
            fallbackIdentifier: entry.creator_id ?? null,
          });
          return;
        }

        const schedulerInfo = normalizeIdentifier(entry.creator_id);
        if (!schedulerInfo) {
          deferredStageAssignments.push({
            stageType,
            leadKey: leadIdentifierKey,
            fallbackIdentifier: entry.creator_id ?? null,
          });
          return;
        }

        initializeEmployee(schedulerInfo.key);
        if (!employeeStats[schedulerInfo.key]) return;
        ensureStageLeadSets(schedulerInfo.key);

        stageLeadSets[schedulerInfo.key][stageType].add(leadIdentifierKey);
        globalStageLeadSet.add(leadIdentifierKey);
      });

      const registerUnactivatedLead = (rawIdentifier: any, leadKey: string, source: string) => {
        if (!leadKey) return;
        ensureLeadTracked(leadKey);
        let normalized = normalizeIdentifier(rawIdentifier);
        if (!normalized && rawIdentifier && typeof rawIdentifier === 'string') {
          const matchedDisplay = Object.entries(employeeIdToName).find(
            ([, name]) => name.toLowerCase() === rawIdentifier.toString().toLowerCase()
          );
          if (matchedDisplay) {
            normalized = { key: matchedDisplay[0], displayName: matchedDisplay[1] };
          } else {
            const parts = rawIdentifier
              .toString()
              .split('-')
              .map((part: string) => part.trim())
              .filter(Boolean);
            for (const part of parts) {
              if (part && part.toLowerCase() !== rawIdentifier.toString().toLowerCase()) {
                const partMatch = normalizeIdentifier(part);
                if (partMatch) {
                  normalized = partMatch;
                  break;
                }
              }
            }
          }
        }
        if (!normalized) {
          console.warn(
            '🔍 Scheduled Report - unable to map unactivated_by to employee',
            rawIdentifier,
            'for lead',
            leadKey,
            'source:',
            source
          );
          return;
        }
        initializeEmployee(normalized.key);
        ensureStageLeadSets(normalized.key);
        stageLeadSets[normalized.key].setAsUnactive.add(leadKey);
        globalStageLeadSet.add(leadKey);
      };

      const fetchUnactivatedLeads = async () => {
        let newUnactivatedQuery = supabase
          .from('leads')
          .select('id, unactivated_by, unactivated_at')
          .not('unactivated_at', 'is', null);
        if (filters.fromDate) {
          newUnactivatedQuery = newUnactivatedQuery.gte('unactivated_at', `${filters.fromDate}T00:00:00`);
        }
        if (filters.toDate) {
          newUnactivatedQuery = newUnactivatedQuery.lte('unactivated_at', `${filters.toDate}T23:59:59`);
        }
        const { data: newUnactivatedData, error: newUnactivatedError } = await newUnactivatedQuery;
        if (newUnactivatedError) throw newUnactivatedError;
        newUnactivatedData?.forEach((row: any) => {
          const leadKey = `new-${row.id}`;
          registerUnactivatedLead(row.unactivated_by, leadKey, 'new');
        });

        let legacyUnactivatedQuery = supabase
          .from('leads_lead')
          .select('id, unactivated_by, unactivated_at')
          .not('unactivated_at', 'is', null);
        if (filters.fromDate) {
          legacyUnactivatedQuery = legacyUnactivatedQuery.gte('unactivated_at', `${filters.fromDate}T00:00:00`);
        }
        if (filters.toDate) {
          legacyUnactivatedQuery = legacyUnactivatedQuery.lte('unactivated_at', `${filters.toDate}T23:59:59`);
        }
        const { data: legacyUnactivatedData, error: legacyUnactivatedError } = await legacyUnactivatedQuery;
        if (legacyUnactivatedError) throw legacyUnactivatedError;
        legacyUnactivatedData?.forEach((row: any) => {
          const leadKey = `legacy-${row.id}`;
          registerUnactivatedLead(row.unactivated_by, leadKey, 'legacy');
        });

        console.log('🔍 Scheduled Report - unactivated leads fetched:', {
          new: newUnactivatedData?.length || 0,
          legacy: legacyUnactivatedData?.length || 0,
        });
      };

      await fetchUnactivatedLeads();
      await hydrateLeadMaps();

      const resolveSchedulerForLead = (
        leadKey: string,
        fallbackIdentifier: string | number | null
      ): { key: string; displayName: string } | null => {
        const parsed = parseLeadKey(leadKey);
        const schedulerCandidates: Array<any> = [];

        if (parsed) {
          if (parsed.type === 'new') {
            const leadRecord = newLeadMap.get(parsed.id);
            if (leadRecord) {
              schedulerCandidates.push(leadRecord.scheduler, leadRecord.manager);
            }
          } else if (parsed.type === 'legacy') {
            const leadRecord = legacyLeadMap.get(parsed.id);
            if (leadRecord) {
              schedulerCandidates.push(
                leadRecord.meeting_scheduler_id,
                leadRecord.meeting_manager_id
              );
            }
          }
        }

        if (fallbackIdentifier !== undefined && fallbackIdentifier !== null) {
          schedulerCandidates.push(fallbackIdentifier);
        }

        for (const candidate of schedulerCandidates) {
          const info = normalizeIdentifier(candidate);
          if (info) {
            return info;
          }
        }

        return null;
      };

      meetingStageEntries.forEach(({ leadKey, fallbackIdentifier }) => {
        const schedulerInfo = resolveSchedulerForLead(leadKey, fallbackIdentifier);
        if (!schedulerInfo) return;

        recordMeetingForScheduler(schedulerInfo.key, leadKey);
        ensureStageLeadSets(schedulerInfo.key);
        stageLeadSets[schedulerInfo.key].meetingScheduled.add(leadKey);
        globalStageLeadSet.add(leadKey);
      });

      deferredStageAssignments.forEach(({ stageType, leadKey, fallbackIdentifier }) => {
        const schedulerInfo = resolveSchedulerForLead(leadKey, fallbackIdentifier);
        if (!schedulerInfo) return;

        initializeEmployee(schedulerInfo.key);
        if (!employeeStats[schedulerInfo.key]) return;
        ensureStageLeadSets(schedulerInfo.key);
        stageLeadSets[schedulerInfo.key][stageType].add(leadKey);
        globalStageLeadSet.add(leadKey);
      });

      const globalMeetingLeadSet = new Set<string>(meetingScheduledLeadSet);
      Object.entries(stageLeadSets).forEach(([empId, stageSetGroup]) => {
        if (
          stageSetGroup.precommunication.size > 0 ||
          stageSetGroup.communicationStarted.size > 0 ||
          stageSetGroup.setAsUnactive.size > 0 ||
          stageSetGroup.meetingScheduled.size > 0
        ) {
          console.log('🔍 Scheduled Report - stage sets for employee', empId, {
            precommunication: Array.from(stageSetGroup.precommunication).slice(0, 10),
            communicationStarted: Array.from(stageSetGroup.communicationStarted).slice(0, 10),
            setAsUnactive: Array.from(stageSetGroup.setAsUnactive).slice(0, 10),
            meetingScheduled: Array.from(stageSetGroup.meetingScheduled).slice(0, 10),
          });
        }
      });
      console.log(
        '🔍 Scheduled Report - stage lead set sizes:',
        Object.fromEntries(
          Object.entries(stageLeadSets).map(([empId, sets]) => [
            empId,
            {
              precommunication: sets.precommunication.size,
              communicationStarted: sets.communicationStarted.size,
              setAsUnactive: sets.setAsUnactive.size,
              meetingScheduled: sets.meetingScheduled.size,
            },
          ])
        )
      );

      Object.keys(employeeStats).forEach(empId => {
        ensureStageLeadSets(empId);
        const stageSets = stageLeadSets[empId];
        const schedulerStats = schedulerStageStats[empId] || { leads: new Set<string>(), eventCount: 0 };

        employeeStats[empId].meetingsScheduled = schedulerStats.leads.size;
        employeeStats[empId].precommunication = stageSets.precommunication.size;
        employeeStats[empId].communicationStarted = stageSets.communicationStarted.size;
        employeeStats[empId].setAsUnactive = stageSets.setAsUnactive.size;
        employeeStats[empId].total =
          employeeStats[empId].precommunication +
          employeeStats[empId].communicationStarted +
          employeeStats[empId].setAsUnactive +
          employeeStats[empId].meetingsScheduled;
      });

      const resolveCategoryFromRecord = (record: any): { main: string; sub: string } | null => {
        if (!record) return null;
        const categoryData = record.misc_category;
        if (categoryData) {
          const entry = Array.isArray(categoryData) ? categoryData[0] : categoryData;
          if (entry) {
            const miscMain = entry.misc_maincategory;
            const mainName = Array.isArray(miscMain) ? miscMain?.[0]?.name : miscMain?.name;
            const subName = entry.name;
            if (subName) {
              return {
                main: mainName || 'Uncategorized',
                sub: subName,
              };
            }
          }
        }
        if (record.category) {
          return {
            main: 'Uncategorized',
            sub: record.category,
          };
        }
        if (record.category_id) {
          return {
            main: 'Uncategorized',
            sub: String(record.category_id),
          };
        }
        return null;
      };

      const resolveCategoryForLeadKey = (leadKey: string): { main: string; sub: string } | null => {
        const parsed = parseLeadKey(leadKey);
        if (!parsed) return null;
        if (parsed.type === 'new') {
          const leadRecord = newLeadMap.get(parsed.id);
          const categoryInfo = resolveCategoryFromRecord(leadRecord);
          if (!categoryInfo) {
            console.warn('🔍 Scheduled Report - missing category info for new lead', parsed.id, leadRecord);
          }
          return categoryInfo;
        }
        if (parsed.type === 'legacy') {
          const leadRecord = legacyLeadMap.get(parsed.id);
          const categoryInfo = resolveCategoryFromRecord(leadRecord);
          if (!categoryInfo) {
            console.warn('🔍 Scheduled Report - missing category info for legacy lead', parsed.id, leadRecord);
          }
          return categoryInfo;
        }
        return null;
      };

      const leadDetailsByKey: Record<string, LeadBaseDetail> = {};
      const ensureLeadDetail = (leadKey: string) => {
        if (!leadKey || leadDetailsByKey[leadKey]) return;
        const parsed = parseLeadKey(leadKey);
        if (!parsed) return;
        const record =
          parsed.type === 'new' ? newLeadMap.get(parsed.id) : legacyLeadMap.get(parsed.id);
        const categoryInfo = resolveCategoryForLeadKey(leadKey);
        const manualId = record?.manual_id;
        const leadNumberValue =
          (manualId ?? record?.lead_number ?? record?.leadNumber ?? parsed.id) as string | number;
        const leadNumber = typeof leadNumberValue === 'string'
          ? leadNumberValue
          : leadNumberValue !== undefined && leadNumberValue !== null
          ? String(leadNumberValue)
          : parsed.id;
        const clientName =
          record?.name ||
          record?.full_name ||
          record?.client_name ||
          `Lead ${leadNumber}`;
        leadDetailsByKey[leadKey] = {
          leadKey,
          leadId: parsed.id,
          leadNumber,
          clientName,
          categoryMain: categoryInfo?.main ?? 'Uncategorized',
          categorySub: categoryInfo?.sub ?? 'N/A',
          leadType: parsed.type,
        };
      };

      const employeeLeadBuckets: Record<string, EmployeeLeadBuckets> = {};
      Object.entries(stageLeadSets).forEach(([empId, sets]) => {
        const meetingScheduledKeys = Array.from(sets.meetingScheduled);
        const precommunicationKeys = Array.from(sets.precommunication);
        const communicationStartedKeys = Array.from(sets.communicationStarted);
        const setAsUnactiveKeys = Array.from(sets.setAsUnactive);

        meetingScheduledKeys.forEach(ensureLeadDetail);
        precommunicationKeys.forEach(ensureLeadDetail);
        communicationStartedKeys.forEach(ensureLeadDetail);
        setAsUnactiveKeys.forEach(ensureLeadDetail);

        employeeLeadBuckets[empId] = {
          meetingScheduled: meetingScheduledKeys,
          precommunication: precommunicationKeys,
          communicationStarted: communicationStartedKeys,
          setAsUnactive: setAsUnactiveKeys,
        };
      });

      meetingScheduledLeadSet.forEach(ensureLeadDetail);
      globalStageLeadSet.forEach(ensureLeadDetail);

      const categoryCounts: Record<string, { main: string; sub: string; leadKeys: Set<string> }> = {};

      meetingScheduledLeadSet.forEach(leadKey => {
        const categoryInfo = resolveCategoryForLeadKey(leadKey);
        if (!categoryInfo) return;
        const key = `${categoryInfo.main}|||${categoryInfo.sub}`;
        if (!categoryCounts[key]) {
          categoryCounts[key] = { ...categoryInfo, leadKeys: new Set<string>() };
        }
        categoryCounts[key].leadKeys.add(leadKey);
      });

      const categoryChartDataArray = Object.values(categoryCounts).map((entry: any) => ({
        main: entry.main,
        sub: entry.sub,
        count: entry.leadKeys.size,
      })) as Array<{ main: string; sub: string; count: number }>;

      console.log('Employee stats:', employeeStats);

      // Convert to array and filter out employees with no activity
      const employeeArray = (Object.entries(employeeStats) as Array<[string, any]>)
        .map(([id, stats]) => ({ id, ...stats }))
        .filter(emp => (emp.total > 0 || emp.meetingsScheduled > 0) && emp.fullName)
        .sort((a, b) => b.meetingsScheduled - a.meetingsScheduled);

      console.log('Employee array:', employeeArray);

      // Prepare chart data
      const chartData = employeeArray
        .filter(emp => emp.meetingsScheduled > 0)
        .map(emp => ({
          name: emp.fullName,
        meetings: emp.meetingsScheduled
      }));

      console.log('Chart data:', chartData);
      console.log(
        '🔍 Scheduled Report - employee breakdown:',
        employeeArray.map(emp => ({
          id: emp.id,
          name: emp.fullName,
          meetingsScheduled: emp.meetingsScheduled,
          precommunication: emp.precommunication,
          communicationStarted: emp.communicationStarted,
          setAsUnactive: emp.setAsUnactive,
          total: emp.total,
        }))
      );

      categoryChartDataArray.sort((a, b) => b.count - a.count);
      const categoryChartData = categoryChartDataArray;
      const categoryTableData = categoryChartDataArray.map(item => ({
        category: `${item.main} › ${item.sub}`,
        count: item.count,
      }));

      const totalMeetingOccurrences = totalMeetingEvents;

      const schedulerLeadArray = Object.entries(schedulerStageStats)
        .map(([id, stats]) => ({
          id,
          fullName: employeeIdToName[id] || employeeStats[id]?.fullName || id,
          meetingCount: stats.leads.size,
        }))
        .filter(item => item.meetingCount > 0);
      schedulerLeadArray.sort((a, b) => b.meetingCount - a.meetingCount);
      const topScheduler = schedulerLeadArray[0] || null;

      setResults({
        employeeStats: employeeArray,
        chartData,
        totalMeetings: meetingScheduledLeadSet.size,
        totalEmployees: employeeArray.length,
        topScheduler,
        totalMeetingOccurrences,
        totalLeads: new Set<string>([
          ...Array.from(globalStageLeadSet),
          ...Array.from(globalMeetingLeadSet),
        ]).size,
        categoryChartData,
        categoryTableData,
        employeeLeadBuckets,
        leadDetailsByKey,
      });

    } catch (error) {
      console.error('Error analyzing scheduled meetings:', error);
      alert('Failed to analyze scheduled meetings.');
      setResults(null);
    } finally {
      setIsSearching(false);
    }
  };

  const closeDrawer = () => {
    setDrawerState({
      isOpen: false,
      title: '',
      leads: [],
    });
  };

  const openEmployeeLeadDrawer = (
    employeeId: string,
    metric: EmployeeMetricKey,
    employeeName: string
  ) => {
    if (!results?.employeeLeadBuckets || !results?.leadDetailsByKey) return;
    const bucket: EmployeeLeadBuckets | undefined = results.employeeLeadBuckets[employeeId];
    if (!bucket) return;

    const stageSegments =
      metric === 'total'
        ? [
            { keys: bucket.meetingScheduled, label: metricLabels.meetingScheduled },
            { keys: bucket.precommunication, label: metricLabels.precommunication },
            { keys: bucket.communicationStarted, label: metricLabels.communicationStarted },
            { keys: bucket.setAsUnactive, label: metricLabels.setAsUnactive },
          ]
        : [
            {
              keys: bucket[metric as Exclude<EmployeeMetricKey, 'total'>],
              label: metricLabels[metric],
            },
          ];

    const drawerLeads: EmployeeLeadDrawerItem[] = [];
    stageSegments.forEach(segment => {
      segment.keys.forEach(leadKey => {
        const base: LeadBaseDetail | undefined = results.leadDetailsByKey[leadKey];
        if (base) {
          drawerLeads.push({
            ...base,
            stageLabel: segment.label,
          });
        }
      });
    });

    setDrawerState({
      isOpen: true,
      title: `${employeeName} • ${metricLabels[metric]}`,
      leads: drawerLeads,
    });
  };

  const renderMetricButton = (
    employeeId: string,
    employeeName: string,
    metric: EmployeeMetricKey,
    value: number
  ) => {
    const disabled = !value;
    const handleClick = () => {
      if (!disabled) {
        openEmployeeLeadDrawer(employeeId, metric, employeeName);
      }
    };
    return (
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        className={`w-full text-center font-semibold focus:outline-none ${
          disabled
            ? 'text-gray-400 cursor-not-allowed'
            : 'text-gray-800 hover:text-primary underline decoration-dotted'
        }`}
      >
        {value}
      </button>
    );
  };

  return (
    <div>
      {/* Search Form */}
      <div className="bg-white mb-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 items-end">
          <div className="form-control">
            <label className="label"><span className="label-text">From Date</span></label>
            <input 
              type="date" 
              className="input input-bordered" 
              value={filters.fromDate}
              onChange={e => handleFilterChange('fromDate', e.target.value)} 
            />
          </div>
          <div className="form-control">
            <label className="label"><span className="label-text">To Date</span></label>
            <input 
              type="date" 
              className="input input-bordered" 
              value={filters.toDate}
              onChange={e => handleFilterChange('toDate', e.target.value)} 
            />
          </div>
          <div className="form-control md:flex md:items-end">
          <button 
              className="btn btn-primary w-full md:w-auto" 
            onClick={handleSearch}
            disabled={isSearching}
          >
              {isSearching ? 'Analyzing...' : 'Show'}
          </button>
          </div>
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
                <div className="card text-white shadow-lg" style={{ backgroundColor: '#4218CC' }}>
                  <div className="card-body">
                    <h3 className="text-lg font-semibold opacity-90">Total Meetings Scheduled</h3>
                    <p className="text-3xl font-bold">{results.totalMeetings}</p>
                  </div>
                </div>
                <div className="card text-white shadow-lg" style={{ backgroundColor: '#4218CC' }}>
                  <div className="card-body">
                    <h3 className="text-lg font-semibold opacity-90">Active Employees</h3>
                    <p className="text-3xl font-bold">{results.totalEmployees}</p>
                  </div>
                </div>
                <div className="card text-white shadow-lg" style={{ backgroundColor: '#4218CC' }}>
                  <div className="card-body">
                    <h3 className="text-lg font-semibold opacity-90">Top Scheduler</h3>
                    <p className="text-3xl font-bold">{results.topScheduler ? results.topScheduler.fullName : '--'}</p>
                    <p className="text-sm opacity-80">
                      {results.topScheduler ? `${results.topScheduler.meetingCount} meetings` : 'No meetings found'}
                    </p>
                  </div>
                </div>
                <div className="card text-white shadow-lg" style={{ backgroundColor: '#4218CC' }}>
                  <div className="card-body">
                    <h3 className="text-lg font-semibold opacity-90">Total Meetings Created</h3>
                    <p className="text-3xl font-bold">{results.totalMeetingOccurrences}</p>
                    <p className="text-sm opacity-80">Includes multiple meetings per lead</p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Left Side - Graph */}
                <div className="card bg-white shadow-lg">
                  <div className="card-body">
                    <h3 className="text-xl font-bold mb-6">Meetings Scheduled by Employee</h3>
                    <div>
                      {results.chartData.length > 0 ? (
                        <div className="space-y-3">
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
                        <div className="flex items-center justify-center py-12 text-gray-500">
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
                    <div className="overflow-x-auto">
                      <table className="table w-full text-sm">
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
                              <td className="font-medium">{emp.fullName}</td>
                              <td className="text-center align-middle">
                                {renderMetricButton(emp.id, emp.fullName, 'meetingScheduled', emp.meetingsScheduled)}
                              </td>
                              <td className="text-center align-middle">
                                {renderMetricButton(emp.id, emp.fullName, 'precommunication', emp.precommunication)}
                              </td>
                              <td className="text-center align-middle">
                                {renderMetricButton(
                                  emp.id,
                                  emp.fullName,
                                  'communicationStarted',
                                  emp.communicationStarted
                                )}
                              </td>
                              <td className="text-center align-middle">
                                {renderMetricButton(emp.id, emp.fullName, 'setAsUnactive', emp.setAsUnactive)}
                              </td>
                              <td className="text-center align-middle">
                                {renderMetricButton(emp.id, emp.fullName, 'total', emp.total)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                                </div>
                  </div>
                </div>
              </div>

              {/* Category Breakdown */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="card bg-white shadow-lg">
                  <div className="card-body">
                    <h3 className="text-xl font-bold mb-6">Meetings Scheduled by Category</h3>
                    <div className="space-y-3">
                      {results.categoryChartData && results.categoryChartData.length > 0 ? (
                        results.categoryChartData.map((item: any, index: number) => {
                          const maxCount = Math.max(...results.categoryChartData.map((d: any) => d.count || 0), 1);
                          const percentage = Math.max(15, (item.count / maxCount) * 100);
                          return (
                            <div key={index} className="flex items-center gap-4">
                              <div className="w-48 text-sm font-medium text-right truncate">
                                {item.main} › {item.sub}
                              </div>
                              <div className="flex-1 flex items-center gap-2">
                                <div className="flex-1 bg-gray-200 rounded-full h-6 relative">
                                  <div
                                    className="bg-gradient-to-r from-emerald-500 to-emerald-600 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold transition-all duration-300"
                                    style={{ width: `${percentage}%` }}
                                  >
                                    {item.count}
                                  </div>
                                </div>
                                <span className="text-sm font-bold text-gray-600 w-8">
                                  {item.count}
                                </span>
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div className="flex items-center justify-center h-32 text-gray-500">
                          No category data available
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="card bg-white shadow-lg">
                  <div className="card-body">
                    <h3 className="text-xl font-bold mb-6">Meetings by Category</h3>
                    <div className="overflow-x-auto">
                      <table className="table w-full text-sm">
                        <thead>
                          <tr>
                            <th className="text-xs">Category</th>
                            <th className="text-xs text-right">Meetings</th>
                          </tr>
                        </thead>
                        <tbody>
                          {results.categoryTableData && results.categoryTableData.length > 0 ? (
                            results.categoryTableData.map((row: any, index: number) => (
                              <tr key={index}>
                                <td className="font-medium">{row.category}</td>
                                <td className="text-right font-semibold text-gray-800">{row.count}</td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={2} className="text-center py-6 text-gray-500">
                                No meetings found for the selected criteria.
                              </td>
                            </tr>
                          )}
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
      <EmployeeLeadDrawer
        isOpen={drawerState.isOpen}
        onClose={closeDrawer}
        title={drawerState.title}
        leads={drawerState.leads}
      />
    </div>
  );
};
const RescheduledReport = () => <div className="p-6">Rescheduled Meetings Report Content</div>;
const ResultsReport = () => <div className="p-6">Results Report Content</div>;
const CollectionReport = () => <div className="p-6">Collection Report Content</div>;
const ActualReport = () => <div className="p-6">Actual Sales Report Content</div>;
const TargetReport = () => <div className="p-6">Target Sales Report Content</div>;
const SchedulingBonusesReport = () => <div className="p-6">Scheduling Bonuses Report Content</div>;
const BonusesV4Report = () => {
  const [filters, setFilters] = useState({
    fromDate: '',
    toDate: '',
    category: '',
    employee: '',
  });
  const [totalBonusAmount, setTotalBonusAmount] = useState<number>(0);
  const [results, setResults] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchPerformed, setSearchPerformed] = useState(false);

  // Category options
  const categoryOptions = ["German Citizenship", "Austrian Citizenship", "Immigration to Israel"];

  // Load users on component mount
  React.useEffect(() => {
    const loadUsers = async () => {
      try {
        const { data, error } = await supabase
          .from('users')
          .select('id, full_name, role')
          .order('full_name');
        
        if (error) throw error;
        setUsers(data || []);
      } catch (error) {
        console.error('Error loading users:', error);
      }
    };
    
    loadUsers();
  }, []);

  const handleFilterChange = (field: string, value: any) => {
    setFilters(prev => ({ ...prev, [field]: value }));
  };

  const handleSearch = async () => {
    setIsSearching(true);
    setSearchPerformed(true);
    try {
      // Step 1: Test basic query without any filters
      console.log('=== STEP 1: Basic query without filters ===');
      let basicQuery = supabase.from('leads').select('*');
      const { data: basicData, error: basicError } = await basicQuery;
      console.log('Basic query results:', basicData?.length || 0, 'leads found');
      if (basicError) console.error('Basic query error:', basicError);

      // Step 2: Test stage filter
      console.log('=== STEP 2: Stage filter ===');
      const signedStages = [
        'Client signed agreement',
        'Mtng sum+Agreement sent'
      ];
      let stageQuery = supabase.from('leads').select('*').in('stage', signedStages);
      const { data: stageData, error: stageError } = await stageQuery;
      console.log('Stage filter results:', stageData?.length || 0, 'leads found');
      if (stageError) console.error('Stage filter error:', stageError);

      // Step 2.5: Check what stages actually exist
      console.log('=== STEP 2.5: Check existing stages ===');
      let stagesQuery = supabase.from('leads').select('stage');
      const { data: stagesData, error: stagesError } = await stagesQuery;
      if (stagesData) {
        const uniqueStages = [...new Set(stagesData.map(lead => lead.stage))];
        console.log('Existing stages in database:', uniqueStages);
      }
      if (stagesError) console.error('Stages query error:', stagesError);

      // Step 3: Test employee filter
      console.log('=== STEP 3: Employee filter ===');
      if (filters.employee) {
        let employeeQuery = supabase.from('leads').select('*').or(`scheduler.eq.${filters.employee},manager.eq.${filters.employee},expert.eq.${filters.employee},closer.eq.${filters.employee}`);
        const { data: employeeData, error: employeeError } = await employeeQuery;
        console.log('Employee filter results:', employeeData?.length || 0, 'leads found');
        if (employeeError) console.error('Employee filter error:', employeeError);
      }

      // Step 4: Test date filter
      console.log('=== STEP 4: Date filter ===');
      if (filters.fromDate || filters.toDate) {
        let dateQuery = supabase.from('leads').select('*');
        if (filters.fromDate) dateQuery = dateQuery.gte('date_signed', filters.fromDate);
        if (filters.toDate) dateQuery = dateQuery.lte('date_signed', filters.toDate);
        const { data: dateData, error: dateError } = await dateQuery;
        console.log('Date filter results:', dateData?.length || 0, 'leads found');
        if (dateError) console.error('Date filter error:', dateError);
      }

      // Now run the full query
      console.log('=== FINAL QUERY ===');
      let query = supabase.from('leads').select('*');

      // Filter for leads with stage "Client Signed Agreement" or higher
      query = query.in('stage', signedStages);

      // Apply date filters based on date_signed from leads table
      if (filters.fromDate) query = query.gte('date_signed', filters.fromDate);
      if (filters.toDate) query = query.lte('date_signed', filters.toDate);
      if (filters.category) query = query.ilike('category', `%${filters.category}%`);

      // Apply employee filter - only show leads where this employee has a role
      if (filters.employee) {
        query = query.or(`scheduler.eq.${filters.employee},manager.eq.${filters.employee},expert.eq.${filters.employee},closer.eq.${filters.employee}`);
      }

      console.log('Search filters:', filters);
      const { data, error } = await query.order('date_signed', { ascending: false });

      if (error) {
        console.error('Supabase error:', error);
        throw error;
      }
      
      console.log('Raw data from Supabase:', data);
      
      // Calculate results with bonus information
      const processedResults = (data || []).map(lead => {
        const leadValue = lead.balance || 0;
        const leadValueInNIS = lead.balance_currency === 'USD' ? leadValue * 3.7 : leadValue; // Assuming 1 USD = 3.7 NIS
        
        // Get roles for this lead
        const roles = [];
        if (lead.scheduler) roles.push({ role: 'scheduler', name: lead.scheduler });
        if (lead.manager) roles.push({ role: 'manager', name: lead.manager });
        if (lead.expert) roles.push({ role: 'expert', name: lead.expert });
        if (lead.closer) roles.push({ role: 'closer', name: lead.closer });
        
        const roleCount = roles.length;
        
        // Calculate total value of all leads for proportion calculation
        const totalValue = data.reduce((sum, l) => sum + (l.balance || 0), 0);
        
        // Calculate bonus as a percentage of the lead value itself
        const totalBonus = leadValue * 0.17; // 17% of lead value as bonus
        const bonusPerRole = roleCount > 0 ? totalBonus / roleCount : 0;
        
        return {
          ...lead,
          leadValueInNIS,
          roles,
          totalBonus,
          bonusPerRole
        };
      });

      console.log('Processed results:', processedResults);
      setResults(processedResults);
    } catch (error) {
      console.error('Error searching leads:', error);
      alert('Failed to search for leads.');
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const getTotalValue = (leads: any[]) => {
    return leads.reduce((sum, lead) => sum + (lead.balance || 0), 0);
  };

  const getEmployeeBonus = (lead: any, selectedEmployee: string) => {
    if (!selectedEmployee || !lead.roles) return 0;
    
    // Count how many roles this employee has in this lead
    const employeeRoles = lead.roles.filter((role: any) => role.name === selectedEmployee);
    const roleCount = employeeRoles.length;
    
    // Employee gets bonusPerRole for each role they have
    return roleCount * (lead.bonusPerRole || 0);
  };

  // Calculate totals for the table
  const calculateTotals = () => {
    // Calculate total lead values (original currency)
    const totalLeadValues = results.reduce((sum, lead) => {
      const leadValue = lead.balance || 0;
      return sum + leadValue;
    }, 0);
    
    // Calculate total lead values in NIS
    const totalLeadValuesNIS = results.reduce((sum, lead) => {
      const leadValueInNIS = lead.leadValueInNIS || 0;
      return sum + leadValueInNIS;
    }, 0);
    
    // Calculate total bonuses by summing the actual values displayed in the Total Bonus column
    const totalBonuses = results.reduce((sum, lead) => {
      // Use the actual totalBonus value that's displayed in the table
      const bonus = lead.totalBonus || 0;
      return sum + bonus;
    }, 0);
    
    // Calculate total employee bonuses by summing the actual values displayed in the Employee Bonus column
    let totalEmployeeBonuses = 0;
    if (filters.employee) {
      // If specific employee is selected, sum only their bonuses
      totalEmployeeBonuses = results.reduce((sum, lead) => {
        const employeeBonus = getEmployeeBonus(lead, filters.employee);
        return sum + employeeBonus;
      }, 0);
    } else {
      // If no specific employee is selected, sum all employee bonuses from all leads
      totalEmployeeBonuses = results.reduce((sum, lead) => {
        // Sum bonuses for all employees in this lead
        const leadEmployeeBonuses = lead.roles ? lead.roles.reduce((roleSum: number, role: any) => {
          return roleSum + (lead.bonusPerRole || 0);
        }, 0) : 0;
        return sum + leadEmployeeBonuses;
      }, 0);
    }
    
    return { totalLeadValues, totalLeadValuesNIS, totalBonuses, totalEmployeeBonuses };
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

  const { totalLeadValues, totalLeadValuesNIS, totalBonuses, totalEmployeeBonuses } = calculateTotals();

  return (
    <div className="space-y-6">
      {/* Filters Section */}
      <div className="bg-white shadow-none">
        <div className="card-body">
          <h3 className="card-title text-lg font-semibold mb-4">Filters</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <div>
              <label className="label">
                <span className="label-text font-medium">From Meeting Date</span>
              </label>
              <input
                type="date"
                className="input input-bordered w-full"
                value={filters.fromDate}
                onChange={(e) => handleFilterChange('fromDate', e.target.value)}
              />
            </div>

            <div>
              <label className="label">
                <span className="label-text font-medium">To Meeting Date</span>
              </label>
              <input
                type="date"
                className="input input-bordered w-full"
                value={filters.toDate}
                onChange={(e) => handleFilterChange('toDate', e.target.value)}
              />
            </div>

            <div>
              <label className="label">
                <span className="label-text font-medium">Category</span>
              </label>
              <select
                className="select select-bordered w-full"
                value={filters.category}
                onChange={(e) => handleFilterChange('category', e.target.value)}
              >
                <option value="">All Categories</option>
                {categoryOptions.map(option => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="label">
                <span className="label-text font-medium">Employee</span>
              </label>
              <select
                className="select select-bordered w-full"
                value={filters.employee}
                onChange={(e) => handleFilterChange('employee', e.target.value)}
              >
                <option value="">All Employees</option>
                {users.map(user => (
                  <option key={user.id} value={user.full_name}>{user.full_name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="label">
                <span className="label-text font-medium">Total Bonuses Amount (Base Calculation)</span>
              </label>
              <input
                type="number"
                className="input input-bordered w-full"
                value={totalBonusAmount}
                onChange={(e) => setTotalBonusAmount(parseFloat(e.target.value) || 0)}
                placeholder="Enter total bonus amount"
              />
            </div>
          </div>

          <div className="flex gap-2">
            <button
              className="btn btn-primary flex items-center gap-2"
              onClick={handleSearch}
              disabled={isSearching}
            >
              {isSearching ? (
                <>
                  <span className="loading loading-spinner loading-sm"></span>
                  Searching...
                </>
              ) : (
                <>
                  <MagnifyingGlassIcon className="w-4 h-4" />
                  Search
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Results Section */}
      {searchPerformed && (
        <div className="card bg-base-100 shadow-md">
          <div className="card-body">
            <h3 className="card-title text-lg font-semibold mb-4">
              Results ({results.length} leads found)
            </h3>

            {results.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="table w-full">
                  <thead>
                    <tr>
                      <th>Lead</th>
                      <th>Stage</th>
                      <th>Category</th>
                      <th>Scheduler</th>
                      <th>Manager</th>
                      <th>Expert</th>
                      <th>Closer</th>
                      <th>Total Lead</th>
                      <th>Total Lead (NIS)</th>
                      <th>Total Bonus</th>
                      <th>Employee Bonus</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((lead) => (
                      <tr key={lead.id}>
                        <td>
                          <div>
                            <div className="font-semibold">{lead.lead_number}</div>
                            <div className="text-sm text-gray-600">{lead.name}</div>
                          </div>
                        </td>
                        <td>{getStageBadge(lead.stage)}</td>
                        <td>{lead.category || 'N/A'}</td>
                        <td>{lead.scheduler || 'N/A'}</td>
                        <td>{lead.manager || 'N/A'}</td>
                        <td>{lead.expert || 'N/A'}</td>
                        <td>{lead.closer || 'N/A'}</td>
                        <td>
                          {lead.balance ? 
                            `${lead.balance.toLocaleString()} ${lead.balance_currency || '₪'}` : 
                            'N/A'
                          }
                        </td>
                        <td>
                          {lead.leadValueInNIS ? 
                            `${lead.leadValueInNIS.toLocaleString()} NIS` : 
                            'N/A'
                          }
                        </td>
                        <td>
                          {lead.totalBonus ? 
                            `${lead.totalBonus.toFixed(2)} NIS` : 
                            '0.00 NIS'
                          }
                        </td>
                        <td>
                          {filters.employee ? 
                            `${getEmployeeBonus(lead, filters.employee).toFixed(2)} NIS` : 
                            'Select Employee'
                          }
                        </td>
                      </tr>
                    ))}
                    {/* Totals Row */}
                    <tr className="bg-gray-50 border-t-2 border-gray-300">
                      <td></td>
                      <td></td>
                      <td></td>
                      <td></td>
                      <td></td>
                      <td></td>
                      <td></td>
                      <td></td>
                      <td className="text-lg font-semibold text-gray-800 text-center">
                        {totalLeadValuesNIS ? 
                          `${totalLeadValuesNIS.toLocaleString()} NIS` : 
                          '0 NIS'
                        }
                      </td>
                      <td className="text-lg font-semibold text-gray-800 text-center">
                        {totalBonuses.toFixed(2)} NIS
                      </td>
                      <td className="text-lg font-semibold text-gray-800 text-center">
                        {filters.employee ? `${totalEmployeeBonuses.toFixed(2)} NIS` : 'N/A'}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                {isSearching ? 'Searching...' : 'No results found'}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
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

type ReportItem = {
  label: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  component?: React.FC;
  route?: string;
};

type ReportSection = {
  category: string;
  items: ReportItem[];
};

const reports: ReportSection[] = [
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
      { label: 'Signed', icon: AcademicCapIcon, route: '/sales/signed' },
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
  const navigate = useNavigate();
  const [selectedReport, setSelectedReport] = useState<ReportItem | null>(null);

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
                      onClick={() => {
                        if (item.route) {
                          navigate(item.route);
                          return;
                        }
                        if (item.component) {
                          setSelectedReport(item);
                        }
                      }}
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
              {selectedReport.component ? (
                React.createElement(selectedReport.component)
              ) : (
                <div className="h-full flex items-center justify-center text-gray-500">
                  Report content unavailable. Please select another report.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}