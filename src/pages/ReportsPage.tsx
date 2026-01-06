import React, { useMemo, useState, useEffect } from 'react';
import { MagnifyingGlassIcon, Squares2X2Icon, ArrowUturnDownIcon, DocumentDuplicateIcon, ChartPieIcon, AdjustmentsHorizontalIcon, FunnelIcon, ClockIcon, ArrowPathIcon, CheckCircleIcon, BanknotesIcon, UserGroupIcon, UserIcon, AcademicCapIcon, StarIcon, PlusIcon, ClipboardDocumentCheckIcon, ChartBarIcon, ListBulletIcon, CurrencyDollarIcon, BriefcaseIcon, ArrowLeftIcon, InformationCircleIcon, RectangleStackIcon, DocumentTextIcon } from '@heroicons/react/24/solid';
import { XMarkIcon, ArrowDownTrayIcon } from '@heroicons/react/24/outline';
import * as XLSX from 'xlsx';
import { toast } from 'react-hot-toast';
import FullSearchReport from './FullSearchReport';
import EditContractsReport from '../components/reports/EditContractsReport';
import { supabase } from '../lib/supabase';
import EmployeeLeadDrawer, {
  EmployeeLeadDrawerItem,
  LeadBaseDetail,
} from '../components/reports/EmployeeLeadDrawer';
import { useNavigate, Link } from 'react-router-dom';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend, Cell } from 'recharts';
import { convertToNIS } from '../lib/currencyConversion';
import { usePersistedFilters } from '../hooks/usePersistedState';

// Stage Search Report Component
const StageSearchReport = () => {
  const [filters, setFilters] = usePersistedFilters('reports_stageSearch_filters', {
    fromDate: '',
    toDate: '',
    stage: '',
    category: '',
  }, {
    storage: 'sessionStorage',
  });
  const [results, setResults] = usePersistedFilters<any[]>('reports_stageSearch_results', [], {
    storage: 'sessionStorage',
  });
  const [isSearching, setIsSearching] = useState(false);
  const [searchPerformed, setSearchPerformed] = usePersistedFilters('reports_stageSearch_performed', false, {
    storage: 'sessionStorage',
  });

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
  const [filters, setFilters] = usePersistedFilters('reports_anchorSearch_filters', {
    name: '',
    dateOfBirth: '',
    placeOfBirth: '',
  }, {
    storage: 'sessionStorage',
  });
  const [results, setResults] = usePersistedFilters<any[]>('reports_anchorSearch_results', [], {
    storage: 'sessionStorage',
  });
  const [isSearching, setIsSearching] = useState(false);
  const [searchPerformed, setSearchPerformed] = usePersistedFilters('reports_anchorSearch_performed', false, {
    storage: 'sessionStorage',
  });

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
      const meetingScheduledStageIds = collectStageIds('Meeting Scheduled', [20, 55]); // Include "Another meeting" stage (55)
      const anotherMeetingStageIds = collectStageIds('Another meeting', [55]);
      // Merge "Another meeting" into meeting scheduled
      anotherMeetingStageIds.forEach(id => {
        if (!meetingScheduledStageIds.includes(id)) {
          meetingScheduledStageIds.push(id);
        }
      });
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

      const meetingScheduledStageNameSet = new Set<string>(['meetingscheduled', 'anothermeeting']);
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
            cdate: entry.cdate, // Store the creation date for matching with meetings
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

      // Group meeting stage entries by leadKey for date-based matching
      const meetingStageEntriesByLead = new Map<string, Array<{ fallbackIdentifier: any; cdate: string }>>();
      meetingStageEntries.forEach(({ leadKey, fallbackIdentifier, cdate }) => {
        if (!meetingStageEntriesByLead.has(leadKey)) {
          meetingStageEntriesByLead.set(leadKey, []);
        }
        meetingStageEntriesByLead.get(leadKey)!.push({ fallbackIdentifier, cdate });
      });
      
      // Sort entries by date for each lead (oldest first for chronological processing)
      meetingStageEntriesByLead.forEach((entries, leadKey) => {
        entries.sort((a, b) => new Date(a.cdate).getTime() - new Date(b.cdate).getTime());
      });
      
      // Process ALL meeting stage entries (count each stage change)
      // This ensures that multiple "meeting scheduled" stage changes for the same lead are all counted
      meetingStageEntries.forEach(({ leadKey, fallbackIdentifier, cdate }) => {
        // Use the creator_id from THIS specific stage entry (not the lead's scheduler field)
        const schedulerInfo = normalizeIdentifier(fallbackIdentifier);
        
        if (!schedulerInfo) {
          // If we can't normalize the creator_id, try fallback resolution
          const fallbackSchedulerInfo = resolveSchedulerForLead(leadKey, fallbackIdentifier);
          if (!fallbackSchedulerInfo) return;
          
          recordMeetingForScheduler(fallbackSchedulerInfo.key, leadKey);
          ensureStageLeadSets(fallbackSchedulerInfo.key);
          stageLeadSets[fallbackSchedulerInfo.key].meetingScheduled.add(leadKey);
          globalStageLeadSet.add(leadKey);
        } else {
          // Found the employee directly from the stage entry's creator_id
          recordMeetingForScheduler(schedulerInfo.key, leadKey);
          ensureStageLeadSets(schedulerInfo.key);
          stageLeadSets[schedulerInfo.key].meetingScheduled.add(leadKey);
          globalStageLeadSet.add(leadKey);
        }
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
const ExpertPipelineReport = () => {
  const navigate = useNavigate();
  const [filters, setFilters] = useState({
    employee: '',
  });
  const [results, setResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchPerformed, setSearchPerformed] = useState(false);
  const [employees, setEmployees] = useState<{ id: number; name: string }[]>([]);
  const [employeeSearch, setEmployeeSearch] = useState<string>('');
  const [showEmployeeDropdown, setShowEmployeeDropdown] = useState<boolean>(false);
  const [allCategories, setAllCategories] = useState<any[]>([]);

  useEffect(() => {
    const fetchOptions = async () => {
      // Fetch employees
      const { data: empData } = await supabase
        .from('tenants_employee')
        .select('id, display_name')
        .order('display_name');
      if (empData) {
        setEmployees(empData.map(emp => ({ id: emp.id, name: emp.display_name || `Employee #${emp.id}` })));
      }

      // Fetch categories for category name resolution
      const { data: catData } = await supabase
        .from('misc_category')
        .select(`
          id,
          name,
          parent_id,
          misc_maincategory!parent_id(
            id,
            name
          )
        `)
        .order('name');
      if (catData) {
        setAllCategories(catData || []);
      }
    };
    fetchOptions();
  }, []);

  const handleFilterChange = (field: string, value: any) => {
    setFilters(prev => ({ ...prev, [field]: value }));
  };

  const getCategoryName = (categoryId: string | number | null | undefined, miscCategory?: any) => {
    if (!categoryId || categoryId === '---' || categoryId === '--') {
      return '---';
    }
    
    if (miscCategory) {
      const cat = Array.isArray(miscCategory) ? miscCategory[0] : miscCategory;
      const mainCategory = Array.isArray(cat?.misc_maincategory) ? cat.misc_maincategory[0] : cat?.misc_maincategory;
      if (mainCategory?.name && cat?.name) {
        return `${cat.name} (${mainCategory.name})`;
      }
      if (cat?.name) {
        return cat.name;
      }
    }

    const foundCategory = allCategories.find((cat: any) => cat.id.toString() === categoryId.toString());
    if (foundCategory) {
      const mainCategory = Array.isArray(foundCategory.misc_maincategory) 
        ? foundCategory.misc_maincategory[0] 
        : foundCategory.misc_maincategory;
      if (mainCategory?.name) {
        return `${foundCategory.name} (${mainCategory.name})`;
      }
      return foundCategory.name;
    }
    
    return String(categoryId);
  };

  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return '---';
    try {
      const date = new Date(dateStr);
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const year = String(date.getFullYear()).slice(-2);
      return `${day}.${month}.${year}`;
    } catch {
      return '---';
    }
  };

  // Helper function to get meeting color based on date (same as ExpertPage.tsx)
  const getMeetingColor = (meetingDateStr: string | null | undefined): string => {
    if (!meetingDateStr) return 'bg-gray-100 text-gray-600';
    
    // Extract date part
    const dateOnly = meetingDateStr.split(' ')[0];
    const meetingDate = new Date(dateOnly);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Set meeting date to start of day for comparison
    const meetingDateStart = new Date(meetingDate);
    meetingDateStart.setHours(0, 0, 0, 0);
    
    // Calculate difference in days
    const diffTime = meetingDateStart.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays < 0) {
      // Past meeting - red
      return 'bg-red-500 text-white';
    } else {
      // Today or future - green
      return 'bg-green-500 text-white';
    }
  };

  const getHandlerOpinion = (handlerNotes: any): string => {
    if (!handlerNotes) return '---';
    if (Array.isArray(handlerNotes) && handlerNotes.length > 0) {
      const lastNote = handlerNotes[handlerNotes.length - 1];
      if (typeof lastNote === 'string') {
        return lastNote;
      }
      if (lastNote?.content) {
        return lastNote.content;
      }
      return JSON.stringify(lastNote);
    }
    if (typeof handlerNotes === 'string') {
      return handlerNotes;
    }
    return '---';
  };

  const handleSearch = async () => {
    setIsSearching(true);
    setSearchPerformed(true);
    try {
      const selectedEmployeeId = filters.employee ? parseInt(filters.employee) : null;

      // Fetch new leads that need expert examination
      let newLeadsQuery = supabase
        .from('leads')
        .select(`
          id,
          lead_number,
          name,
          created_at,
          expert,
          category_id,
          category,
          handler_notes,
          scheduler,
          manager,
          stage,
          meetings (
            meeting_date
          ),
          misc_category!category_id(
            id,
            name,
            parent_id,
            misc_maincategory!parent_id(
              id,
              name
            )
          )
        `)
        .or('eligibility_status.is.null,eligibility_status.eq.""')
        .gte('stage', 20)
        .lt('stage', 60)
        .neq('stage', 35);

      if (selectedEmployeeId) {
        newLeadsQuery = newLeadsQuery.eq('expert', selectedEmployeeId);
      }

      const { data: newLeadsData, error: newLeadsError } = await newLeadsQuery.order('created_at', { ascending: false });

      if (newLeadsError) {
        console.error('Error fetching new leads:', newLeadsError);
        throw newLeadsError;
      }

      // Fetch legacy leads that need expert examination
      let legacyLeadsQuery = supabase
        .from('leads_lead')
        .select(`
          id,
          name,
          cdate,
          expert_id,
          category_id,
          category,
          handler_notes,
          meeting_scheduler_id,
          meeting_manager_id,
          stage,
          meeting_date,
          meeting_time,
          misc_category!category_id(
            id,
            name,
            parent_id,
            misc_maincategory!parent_id(
              id,
              name
            )
          )
        `)
        .eq('expert_examination', 0)
        .gte('meeting_date', '2025-01-01')
        .gte('stage', 20)
        .lt('stage', 60)
        .neq('stage', 35);

      if (selectedEmployeeId) {
        legacyLeadsQuery = legacyLeadsQuery.eq('expert_id', selectedEmployeeId);
      }

      const { data: legacyLeadsData, error: legacyLeadsError } = await legacyLeadsQuery.order('cdate', { ascending: false });

      if (legacyLeadsError) {
        console.error('Error fetching legacy leads:', legacyLeadsError);
        throw legacyLeadsError;
      }

      // Fetch stage dates for "meeting scheduled" (stage 20) from leads_leadstage
      const newLeadIds = (newLeadsData || []).map(lead => lead.id).filter(Boolean);
      const legacyLeadIds = (legacyLeadsData || []).map(lead => lead.id).filter(Boolean);

      // Fetch stage dates for new leads
      const stageDatesMap: Record<string, string> = {};
      if (newLeadIds.length > 0) {
        const { data: newLeadStageData } = await supabase
          .from('leads_leadstage')
          .select('newlead_id, date')
          .in('newlead_id', newLeadIds)
          .eq('stage', 20)
          .order('date', { ascending: true });

        if (newLeadStageData) {
          // Use the earliest date for each lead (first time stage 20 was set)
          newLeadStageData.forEach((stage: any) => {
            if (stage.newlead_id && stage.date) {
              const leadId = stage.newlead_id;
              if (!stageDatesMap[leadId] || new Date(stage.date) < new Date(stageDatesMap[leadId])) {
                stageDatesMap[leadId] = stage.date;
              }
            }
          });
        }
      }

      // Fetch stage dates for legacy leads
      if (legacyLeadIds.length > 0) {
        const { data: legacyLeadStageData } = await supabase
          .from('leads_leadstage')
          .select('lead_id, date')
          .in('lead_id', legacyLeadIds)
          .eq('stage', 20)
          .order('date', { ascending: true });

        if (legacyLeadStageData) {
          // Use the earliest date for each lead (first time stage 20 was set)
          legacyLeadStageData.forEach((stage: any) => {
            if (stage.lead_id && stage.date) {
              const leadId = `legacy_${stage.lead_id}`;
              if (!stageDatesMap[leadId] || new Date(stage.date) < new Date(stageDatesMap[leadId])) {
                stageDatesMap[leadId] = stage.date;
              }
            }
          });
        }
      }

      // Fetch ALL employees to create a complete mapping
      const { data: allEmployeesData } = await supabase
        .from('tenants_employee')
        .select('id, display_name');
      
      const employeeNameMap: Record<number, string> = {};
      const employeeNameToIdMap: Record<string, number> = {};
      
      if (allEmployeesData) {
        allEmployeesData.forEach(emp => {
          if (emp.id && emp.display_name) {
            employeeNameMap[emp.id] = emp.display_name;
            employeeNameToIdMap[emp.display_name.toLowerCase()] = emp.id;
          }
        });
      }

      // Helper function to resolve employee name from ID or name
      const resolveEmployeeName = (value: any): string => {
        if (!value) return '---';
        
        // If it's already a number (employee ID)
        if (typeof value === 'number') {
          return employeeNameMap[value] || `Employee ${value}`;
        }
        
        // If it's a string that's a number (employee ID as string)
        const numericValue = parseInt(String(value));
        if (!isNaN(numericValue) && String(numericValue) === String(value).trim()) {
          return employeeNameMap[numericValue] || `Employee ${numericValue}`;
        }
        
        // If it's already a name, check if we can find the ID and get the display_name
        const nameLower = String(value).toLowerCase().trim();
        const foundId = employeeNameToIdMap[nameLower];
        if (foundId && employeeNameMap[foundId]) {
          return employeeNameMap[foundId];
        }
        
        // If it's already a display name, return it as is
        return String(value);
      };

      // Process new leads
      const processedNewLeads = (newLeadsData || []).map(lead => {
        // Filter by meeting date from 2025 onwards
        const hasMeetingIn2025OrLater = lead.meetings && lead.meetings.length > 0 && lead.meetings.some((meeting: any) => {
          const meetingDate = new Date(meeting.meeting_date);
          return meetingDate.getFullYear() >= 2025;
        });

        if (!hasMeetingIn2025OrLater) return null;

        const meetingDate = lead.meetings && lead.meetings.length > 0 
          ? lead.meetings[0].meeting_date 
          : null;

        return {
          id: lead.id,
          lead_number: lead.lead_number || lead.id,
          name: lead.name || 'Unnamed Lead',
          category: getCategoryName(lead.category_id, lead.misc_category),
          meeting_date: meetingDate,
          meeting_scheduler: resolveEmployeeName(lead.scheduler),
          meeting_manager: resolveEmployeeName(lead.manager),
          handler_opinion: getHandlerOpinion(lead.handler_notes),
          assigned_date: stageDatesMap[lead.id] || null,
          lead_type: 'new' as const
        };
      }).filter(Boolean);

      // Process legacy leads
      const processedLegacyLeads = (legacyLeadsData || []).map(lead => {
        const meetingDate = lead.meeting_date 
          ? (lead.meeting_time ? `${lead.meeting_date} ${lead.meeting_time}` : lead.meeting_date)
          : null;

        return {
          id: `legacy_${lead.id}`,
          lead_number: lead.id?.toString() || '',
          name: lead.name || 'Unnamed Lead',
          category: getCategoryName(lead.category_id, lead.misc_category),
          meeting_date: meetingDate,
          meeting_scheduler: resolveEmployeeName(lead.meeting_scheduler_id),
          meeting_manager: resolveEmployeeName(lead.meeting_manager_id),
          handler_opinion: getHandlerOpinion(lead.handler_notes),
          assigned_date: stageDatesMap[`legacy_${lead.id}`] || null,
          lead_type: 'legacy' as const
        };
      });

      // Combine and sort by meeting date
      const allLeads = [...processedNewLeads, ...processedLegacyLeads].filter(Boolean).sort((a, b) => {
        if (!a || !b) return 0;
        if (!a.meeting_date && !b.meeting_date) return 0;
        if (!a.meeting_date) return 1;
        if (!b.meeting_date) return -1;
        return new Date(a.meeting_date).getTime() - new Date(b.meeting_date).getTime();
      });

      setResults(allLeads);
    } catch (error: any) {
      console.error('Error fetching expert pipeline:', error);
      toast.error('Failed to fetch expert pipeline data');
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  // Filter employees based on search
  const filteredEmployees = employees.filter((emp: any) => 
    emp.name.toLowerCase().includes(employeeSearch.toLowerCase())
  );

  return (
    <div className="px-2 py-6">
      <h2 className="text-2xl font-bold mb-6 px-4">
        Expert Pipeline
        {searchPerformed && (
          <span className="ml-2 text-lg font-normal text-gray-600">
            ({results.length} {results.length === 1 ? 'lead' : 'leads'})
          </span>
        )}
      </h2>
      
      {/* Filters */}
      <div className="mb-6 px-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="relative">
            <label className="block text-sm font-medium text-gray-700 mb-1">Employee:</label>
            <div className="relative">
              <input
                type="text"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Search employee..."
                value={employeeSearch}
                onChange={(e) => {
                  setEmployeeSearch(e.target.value);
                  setShowEmployeeDropdown(true);
                  if (!e.target.value) {
                    handleFilterChange('employee', '');
                  }
                }}
                onFocus={() => setShowEmployeeDropdown(true)}
                onBlur={() => setTimeout(() => setShowEmployeeDropdown(false), 200)}
              />
              {showEmployeeDropdown && filteredEmployees.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                  <div
                    className="px-4 py-2 cursor-pointer hover:bg-gray-100 text-sm"
                    onClick={() => {
                      handleFilterChange('employee', '');
                      setEmployeeSearch('');
                      setShowEmployeeDropdown(false);
                    }}
                  >
                    All Employees
                  </div>
                  {filteredEmployees.map((emp) => (
                    <div
                      key={emp.id}
                      className="px-4 py-2 cursor-pointer hover:bg-gray-100 text-sm"
                      onClick={() => {
                        handleFilterChange('employee', emp.id.toString());
                        setEmployeeSearch(emp.name);
                        setShowEmployeeDropdown(false);
                      }}
                    >
                      {emp.name}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-end">
            <button
              onClick={handleSearch}
              disabled={isSearching}
              className="btn btn-primary w-full md:w-auto"
            >
              {isSearching ? 'Loading...' : 'Show'}
            </button>
          </div>
        </div>
      </div>

      {/* Results */}
      {searchPerformed && (
        <div className="px-4">
          <h3 className="text-lg font-semibold mb-4">Expert Examination required</h3>
          {results.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              No leads found requiring expert examination.
            </div>
          ) : (
            <div className="overflow-x-auto -mx-2">
              <div className="px-4">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Lead</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Category</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Assigned Date</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Meeting Date</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Meeting Scheduler</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Meeting Manager</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Handler opinion</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {results.map((lead, index) => (
                      <tr key={lead.id || index} className="hover:bg-gray-50">
                        <td className="px-4 py-4 whitespace-nowrap">
                          <Link
                            to={`/clients/${lead.lead_number}`}
                            className="text-blue-600 hover:text-blue-800 font-semibold"
                          >
                            #{lead.lead_number} {lead.name}
                          </Link>
                        </td>
                        <td className="px-4 py-4 text-sm text-gray-900">{lead.category}</td>
                        <td className="px-4 py-4 text-sm text-gray-900">
                          {lead.assigned_date ? formatDate(lead.assigned_date) : '---'}
                        </td>
                        <td className="px-4 py-4 text-sm text-gray-900">
                          {lead.meeting_date ? (
                            <span className={`px-2 py-1 rounded font-semibold ${getMeetingColor(lead.meeting_date)}`}>
                              {formatDate(lead.meeting_date)}
                            </span>
                          ) : (
                            '---'
                          )}
                        </td>
                        <td className="px-4 py-4 text-sm text-gray-900">{lead.meeting_scheduler}</td>
                        <td className="px-4 py-4 text-sm text-gray-900">{lead.meeting_manager}</td>
                        <td className="px-4 py-4 text-sm text-gray-900 max-w-xs">
                          <div className="line-clamp-2 break-words" title={lead.handler_opinion !== '---' ? lead.handler_opinion : undefined}>
                            {lead.handler_opinion}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const ExpertReport = ExpertPipelineReport;
const SchedulerSuperPipelineReport = () => {
  const navigate = useNavigate();
  const today = new Date().toISOString().split('T')[0];
  const [filters, setFilters] = usePersistedFilters('reports_schedulerPipeline_filters', {
    fromDate: today,
    toDate: today,
    category: '',
    employee: '',
    language: '',
  }, {
    storage: 'sessionStorage',
  });
  const [results, setResults] = usePersistedFilters<any[]>('reports_schedulerPipeline_results', [], {
    storage: 'sessionStorage',
  });
  const [isSearching, setIsSearching] = useState(false);
  const [searchPerformed, setSearchPerformed] = usePersistedFilters('reports_schedulerPipeline_performed', false, {
    storage: 'sessionStorage',
  });
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [employees, setEmployees] = useState<{ id: number; name: string }[]>([]);
  const [languages, setLanguages] = useState<{ id: string; name: string }[]>([]);
  const [editingManagerNotes, setEditingManagerNotes] = useState<Record<string, boolean>>({});
  const [managerNotesValues, setManagerNotesValues] = useState<Record<string, string>>({});
  const [savingManagerNotes, setSavingManagerNotes] = useState<Record<string, boolean>>({});
  const [categorySearch, setCategorySearch] = useState<string>('');
  const [employeeSearch, setEmployeeSearch] = useState<string>('');
  const [languageSearch, setLanguageSearch] = useState<string>('');
  const [showCategoryDropdown, setShowCategoryDropdown] = useState<boolean>(false);
  const [showEmployeeDropdown, setShowEmployeeDropdown] = useState<boolean>(false);
  const [showLanguageDropdown, setShowLanguageDropdown] = useState<boolean>(false);

  useEffect(() => {
    const fetchOptions = async () => {
      // Fetch categories
      const { data: catData } = await supabase
        .from('misc_maincategory')
        .select('id, name')
        .order('name');
      if (catData) {
        setCategories(catData.map(cat => ({ id: cat.id.toString(), name: cat.name })));
      }

      // No need to fetch all categories - we only use main categories

      // Fetch employees
      const { data: empData } = await supabase
        .from('tenants_employee')
        .select('id, display_name')
        .order('display_name');
      if (empData) {
        setEmployees(empData.map(emp => ({ id: emp.id, name: emp.display_name || `Employee #${emp.id}` })));
      }

      // Fetch languages
      const { data: langData } = await supabase
        .from('misc_language')
        .select('id, name')
        .order('name');
      if (langData) {
        setLanguages(langData.map(lang => ({ id: lang.id.toString(), name: lang.name })));
      }
    };
    fetchOptions();
  }, []);

  const handleFilterChange = (field: string, value: any) => {
    setFilters(prev => ({ ...prev, [field]: value }));
  };

  const getCategoryName = (categoryId: string | number | null | undefined, fallbackCategory?: string | number) => {
    // For display purposes, we'll show a simple category name
    // This function is used for displaying category names in the results
    if (!categoryId || categoryId === '---' || categoryId === '--') {
      return '---';
    }

    // Try to find the main category by looking up subcategories
    // For now, return a simple display - this can be enhanced if needed
    return fallbackCategory ? String(fallbackCategory) : '---';
  };

  const getStageName = (stageId: string | number | null | undefined) => {
    if (!stageId) return '---';
    // Stage names mapping - you may need to fetch from lead_stages table
    const stageMap: Record<string, string> = {
      '0': 'Created',
      '10': 'Scheduler assigned',
      '11': 'Precommunication',
      '15': 'Communication started',
      '20': 'Meeting scheduled',
      '21': 'Meeting rescheduling',
      '30': 'Meeting complete',
      '35': 'Meeting Irrelevant',
      '40': 'Waiting for Mtng sum',
      '50': 'Mtng sum+Agreement sent',
      '51': 'Client declined price offer',
      '55': 'Another meeting',
      '60': 'Client signed agreement',
      '70': 'Payment request sent',
      '91': 'Dropped (Spam/Irrelevant)',
      '100': 'Success',
      '105': 'Handler Set',
      '110': 'Handler Started',
      '150': 'Application submitted',
      '200': 'Case Closed'
    };
    return stageMap[String(stageId)] || String(stageId);
  };

  const formatCurrency = (amount: number | null | undefined, currency: string | null | undefined) => {
    if (!amount) return '---';
    const symbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : currency === 'NIS' ? '₪' : currency || '';
    return `${symbol} ${amount.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
  };

  const formatNoteText = (text: string): string => {
    if (!text) return '';
    return text.replace(/\n/g, '<br>');
  };

  const fetchCurrentUserName = async (): Promise<string> => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: userRow } = await supabase
          .from('users')
          .select('full_name')
          .eq('auth_id', user.id)
          .maybeSingle();
        if (userRow?.full_name) {
          return userRow.full_name;
        }
        if (user.user_metadata?.full_name) {
          return user.user_metadata.full_name;
        }
        if (user.email) {
          return user.email;
        }
      }
      return 'Unknown User';
    } catch (error) {
      console.error('Error fetching current user name:', error);
      return 'Unknown User';
    }
  };

  const handleSaveManagerNotes = async (lead: any) => {
    const leadId = lead.id || lead.lead_number;
    if (!leadId) return;

    setSavingManagerNotes(prev => ({ ...prev, [lead.id || lead.lead_number]: true }));
    try {
      const userName = await fetchCurrentUserName();
      const tableName = lead.lead_type === 'legacy' ? 'leads_lead' : 'leads';
      const clientId = lead.lead_type === 'legacy' 
        ? (typeof leadId === 'string' ? parseInt(leadId.replace('legacy_', '')) : leadId)
        : leadId;

      const notesText = managerNotesValues[lead.id || lead.lead_number] || '';
      const updateData: any = {
        management_notes: formatNoteText(notesText),
        management_notes_last_edited_by: userName,
        management_notes_last_edited_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from(tableName)
        .update(updateData)
        .eq('id', clientId);

      if (error) throw error;

      // Update local state
      setResults(prev => prev.map(l => 
        l.id === lead.id 
          ? { ...l, manager_notes: formatNoteText(notesText) }
          : l
      ));

      // Clear editing state
      setEditingManagerNotes(prev => {
        const newState = { ...prev };
        delete newState[lead.id || lead.lead_number];
        return newState;
      });
      setManagerNotesValues(prev => {
        const newState = { ...prev };
        delete newState[lead.id || lead.lead_number];
        return newState;
      });

      toast.success('Manager notes saved successfully');
    } catch (error: any) {
      console.error('Error saving manager notes:', error);
      toast.error(`Failed to save manager notes: ${error?.message || 'Unknown error'}`);
    } finally {
      setSavingManagerNotes(prev => {
        const newState = { ...prev };
        delete newState[lead.id || lead.lead_number];
        return newState;
      });
    }
  };

  const handleSearch = async (applyDateFilters: boolean = true) => {
    setIsSearching(true);
    if (applyDateFilters) {
      setSearchPerformed(true);
    }
    try {
      const allLeads: any[] = [];

      // Scheduler pipeline allowed stages: up to stage 40 (Waiting for Mtng sum)
      const allowedStageIds = ['10', '15', '20', '21', '30', '40'];

      // Fetch new leads
      let newLeadsQuery = supabase
        .from('leads')
        .select(`
          id,
          lead_number,
          name,
          created_at,
          scheduler,
          expert,
          manager,
          category,
          category_id,
          stage,
          probability,
          language,
          number_of_applicants_meeting,
          potential_applicants_meeting,
          balance,
          balance_currency,
          expert_notes,
          management_notes
        `)
        .gte('probability', 80) // Only probability >= 80%
        .not('probability', 'is', null) // Exclude null probabilities
        .not('scheduler', 'is', null) // Only leads with scheduler assigned
        .in('stage', allowedStageIds); // Only scheduler stages up to 40

      // Apply date filter only when explicitly requested (when Show is clicked)
      if (applyDateFilters) {
        if (filters.fromDate) {
          newLeadsQuery = newLeadsQuery.gte('created_at', filters.fromDate);
        }
        if (filters.toDate) {
          newLeadsQuery = newLeadsQuery.lte('created_at', filters.toDate);
        }
      }

      // Apply category filter (main category - need to filter by all subcategories)
      if (filters.category) {
        // Fetch all subcategories for this main category
        const { data: subCategories } = await supabase
          .from('misc_category')
          .select('id')
          .eq('parent_id', filters.category);
        
        if (subCategories && subCategories.length > 0) {
          const subCategoryIds = subCategories.map(sc => sc.id.toString());
          newLeadsQuery = newLeadsQuery.in('category_id', subCategoryIds);
        } else {
          // If no subcategories found, return no results
          newLeadsQuery = newLeadsQuery.eq('category_id', -1); // Non-existent ID
        }
      }

      // Apply language filter
      if (filters.language) {
        newLeadsQuery = newLeadsQuery.eq('language', filters.language);
      }

      // Apply employee filter (scheduler)
      if (filters.employee) {
        const employee = employees.find(emp => emp.id.toString() === filters.employee);
        if (employee) {
          newLeadsQuery = newLeadsQuery.eq('scheduler', employee.name);
        }
      }

      const { data: newLeads, error: newLeadsError } = await newLeadsQuery.order('created_at', { ascending: false });

      if (newLeadsError) {
        console.error('Error fetching new leads:', newLeadsError);
        // Continue with empty array - will still try to fetch legacy leads
      }
      
      if (newLeads) {
        newLeads.forEach((lead: any) => {
          // Convert expert_notes array to string
          let expertOpinionText = '---';
          if (lead.expert_notes) {
            if (Array.isArray(lead.expert_notes)) {
              expertOpinionText = lead.expert_notes
                .map((note: any) => note?.content || note)
                .filter(Boolean)
                .join('; ') || '---';
            } else if (typeof lead.expert_notes === 'string') {
              expertOpinionText = lead.expert_notes;
            } else if (lead.expert_notes?.content) {
              expertOpinionText = lead.expert_notes.content;
            }
          }

          // Convert management_notes to string
          let managerNotesText = '---';
          if (lead.management_notes) {
            if (Array.isArray(lead.management_notes)) {
              managerNotesText = lead.management_notes
                .map((note: any) => note?.content || note)
                .filter(Boolean)
                .join('; ') || '---';
            } else if (typeof lead.management_notes === 'string') {
              managerNotesText = lead.management_notes;
            } else if (lead.management_notes?.content) {
              managerNotesText = lead.management_notes.content;
            }
          }

          allLeads.push({
            ...lead,
            lead_type: 'new',
            stage: getStageName(lead.stage), // Convert stage ID to name
            expert_opinion: expertOpinionText,
            manager_notes: managerNotesText,
          });
        });
      }

      // Fetch legacy leads
      // Scheduler pipeline allowed legacy stages: up to stage 40 (Waiting for Mtng sum)
      const allowedLegacyStageIds = [10, 15, 20, 21, 30, 40];
      
      let legacyLeadsQuery = supabase
        .from('leads_lead')
        .select(`
          id,
          name,
          cdate,
          meeting_scheduler_id,
          expert_id,
          meeting_manager_id,
          category_id,
          stage,
          probability,
          language_id,
          no_of_applicants,
          potential_applicants,
          total,
          currency_id,
          expert_notes,
          management_notes
        `)
        .gte('probability', 80) // Only probability >= 80%
        .not('probability', 'is', null) // Exclude null probabilities
        .not('meeting_scheduler_id', 'is', null) // Only leads with scheduler assigned
        .eq('status', 0) // Only active leads
        .in('stage', allowedLegacyStageIds) // Only scheduler stages up to 40
        .eq('eligibile', 'true') // Only eligible leads for scheduler
        .not('eligibile', 'is', null); // Explicitly exclude null values

      // Apply date filter only when explicitly requested (when Show is clicked)
      if (applyDateFilters) {
        if (filters.fromDate) {
          legacyLeadsQuery = legacyLeadsQuery.gte('cdate', filters.fromDate);
        }
        if (filters.toDate) {
          legacyLeadsQuery = legacyLeadsQuery.lte('cdate', filters.toDate);
        }
      }

      // Apply category filter (main category - need to filter by all subcategories)
      if (filters.category) {
        // Fetch all subcategories for this main category
        const { data: subCategories } = await supabase
          .from('misc_category')
          .select('id')
          .eq('parent_id', filters.category);
        
        if (subCategories && subCategories.length > 0) {
          const subCategoryIds = subCategories.map(sc => sc.id);
          legacyLeadsQuery = legacyLeadsQuery.in('category_id', subCategoryIds);
        } else {
          // If no subcategories found, return no results
          legacyLeadsQuery = legacyLeadsQuery.eq('category_id', -1); // Non-existent ID
        }
      }

      // Apply language filter
      if (filters.language) {
        legacyLeadsQuery = legacyLeadsQuery.eq('language_id', Number(filters.language));
      }

      // Apply employee filter (scheduler)
      if (filters.employee) {
        legacyLeadsQuery = legacyLeadsQuery.eq('meeting_scheduler_id', Number(filters.employee));
      }

      const { data: legacyLeads, error: legacyLeadsError } = await legacyLeadsQuery.order('cdate', { ascending: false });

      if (legacyLeadsError) {
        console.error('Error fetching legacy leads:', legacyLeadsError);
        // Continue with empty array instead of breaking
        setResults([]);
        setIsSearching(false);
        return;
      }
      
      if (legacyLeads) {
        // Fetch scheduler names for legacy leads
        const schedulerIds = [...new Set(legacyLeads.map((l: any) => l.meeting_scheduler_id).filter(Boolean))];
        const schedulerMap: Record<number, string> = {};
        
        if (schedulerIds.length > 0) {
          const { data: schedulerData } = await supabase
            .from('tenants_employee')
            .select('id, display_name')
            .in('id', schedulerIds);
          
          if (schedulerData) {
            schedulerData.forEach((emp: any) => {
              schedulerMap[emp.id] = emp.display_name || `Employee #${emp.id}`;
            });
          }
        }

        // Fetch currency codes
        const currencyIds = [...new Set(legacyLeads.map((l: any) => l.currency_id).filter(Boolean))];
        const currencyMap: Record<number, string> = {};
        
        if (currencyIds.length > 0) {
          const { data: currencyData } = await supabase
            .from('accounting_currencies')
            .select('id, iso_code')
            .in('id', currencyIds);
          
          if (currencyData) {
            currencyData.forEach((curr: any) => {
              currencyMap[curr.id] = curr.iso_code || '';
            });
          }
        }

        // Fetch language names for legacy leads
        const languageIds = [...new Set(legacyLeads.map((l: any) => l.language_id).filter(Boolean))];
        const languageMap: Record<number, string> = {};
        
        if (languageIds.length > 0) {
          const { data: languageData } = await supabase
            .from('misc_language')
            .select('id, name')
            .in('id', languageIds);
          
          if (languageData) {
            languageData.forEach((lang: any) => {
              languageMap[lang.id] = lang.name || '';
            });
          }
        }

        legacyLeads.forEach((lead: any) => {
          // Convert expert_notes array to string
          let expertOpinionText = '---';
          if (lead.expert_notes) {
            if (Array.isArray(lead.expert_notes)) {
              expertOpinionText = lead.expert_notes
                .map((note: any) => note?.content || note)
                .filter(Boolean)
                .join('; ') || '---';
            } else if (typeof lead.expert_notes === 'string') {
              expertOpinionText = lead.expert_notes;
            } else if (lead.expert_notes?.content) {
              expertOpinionText = lead.expert_notes.content;
            }
          }

          // Convert management_notes to string
          let managerNotesText = '---';
          if (lead.management_notes) {
            if (Array.isArray(lead.management_notes)) {
              managerNotesText = lead.management_notes
                .map((note: any) => note?.content || note)
                .filter(Boolean)
                .join('; ') || '---';
            } else if (typeof lead.management_notes === 'string') {
              managerNotesText = lead.management_notes;
            } else if (lead.management_notes?.content) {
              managerNotesText = lead.management_notes.content;
            }
          }

          allLeads.push({
            id: `legacy_${lead.id}`,
            lead_number: lead.id?.toString() || '',
            name: lead.name || '',
            created_at: lead.cdate || new Date().toISOString(),
            scheduler: schedulerMap[lead.meeting_scheduler_id] || `Employee #${lead.meeting_scheduler_id}`,
            expert: lead.expert_id ? `Expert #${lead.expert_id}` : null,
            manager: lead.meeting_manager_id ? `Manager #${lead.meeting_manager_id}` : null,
            category: getCategoryName(lead.category_id),
            category_id: lead.category_id,
            stage: getStageName(lead.stage),
            probability: lead.probability || 0,
            language: lead.language_id ? (languageMap[lead.language_id] || `Language #${lead.language_id}`) : null,
            number_of_applicants_meeting: lead.no_of_applicants || 0,
            potential_applicants_meeting: lead.potential_applicants || 0,
            balance: lead.total || 0,
            balance_currency: currencyMap[lead.currency_id] || null,
            expert_opinion: expertOpinionText,
            manager_notes: managerNotesText,
            lead_type: 'legacy',
          });
        });
      }

      // Sort by probability (highest first), then by created_at (newest first)
      const sortedLeads = allLeads.sort((a, b) => {
        const probA = a.probability || 0;
        const probB = b.probability || 0;
        if (probB !== probA) {
          return probB - probA; // Higher probability first
        }
        // If probabilities are equal, sort by created_at (newest first)
        const dateA = new Date(a.created_at || 0).getTime();
        const dateB = new Date(b.created_at || 0).getTime();
        return dateB - dateA;
      });
      
      setResults(sortedLeads);
    } catch (error: any) {
      console.error('Error in SchedulerSuperPipelineReport:', error);
      toast.error(`Error fetching leads: ${error?.message || 'Unknown error'}`);
      setResults([]); // Set empty results on error
    } finally {
      setIsSearching(false);
    }
  };

  // Automatically load all leads on component mount (without date filters)
  useEffect(() => {
    handleSearch(false); // Pass false to skip date filters on initial load
    setSearchPerformed(true); // Show the table with initial results
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty dependency array means this runs once on mount

  // Sync search inputs with selected filters
  useEffect(() => {
    if (filters.category) {
      const selectedCategory = categories.find(cat => cat.id.toString() === filters.category);
      setCategorySearch(selectedCategory ? selectedCategory.name : '');
    } else {
      setCategorySearch('');
    }
  }, [filters.category, categories]);

  useEffect(() => {
    if (filters.employee) {
      const selectedEmployee = employees.find(emp => emp.id.toString() === filters.employee);
      setEmployeeSearch(selectedEmployee ? selectedEmployee.name : '');
    } else {
      setEmployeeSearch('');
    }
  }, [filters.employee, employees]);

  useEffect(() => {
    if (filters.language) {
      const selectedLanguage = languages.find(lang => lang.id === filters.language);
      setLanguageSearch(selectedLanguage ? selectedLanguage.name : '');
    } else {
      setLanguageSearch('');
    }
  }, [filters.language, languages]);

  // Filter options based on search
  const filteredCategories = categories.filter((cat: any) => {
    const searchTerm = categorySearch.toLowerCase();
    const catName = cat.name?.toLowerCase() || '';
    return catName.includes(searchTerm);
  });

  const filteredEmployees = employees.filter((emp: any) => 
    emp.name.toLowerCase().includes(employeeSearch.toLowerCase())
  );

  const filteredLanguages = languages.filter((lang: any) => 
    lang.name.toLowerCase().includes(languageSearch.toLowerCase())
  );

  return (
    <div className="px-2 py-6">
      <h2 className="text-2xl font-bold mb-6 px-4">Scheduler Super Pipeline</h2>
      
      {/* Filters */}
      <div className="mb-6 px-4">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">From Date</label>
              <input
                type="date"
                value={filters.fromDate}
                onChange={(e) => handleFilterChange('fromDate', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">To Date</label>
              <input
                type="date"
                value={filters.toDate}
                onChange={(e) => handleFilterChange('toDate', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="relative">
              <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
              <input
                type="text"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Search category..."
                value={categorySearch}
                onChange={(e) => {
                  setCategorySearch(e.target.value);
                  setShowCategoryDropdown(true);
                  if (!e.target.value) {
                    handleFilterChange('category', '');
                  }
                }}
                onFocus={() => setShowCategoryDropdown(true)}
                onBlur={() => setTimeout(() => setShowCategoryDropdown(false), 200)}
              />
              {showCategoryDropdown && filteredCategories.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                  <div
                    className="px-4 py-2 cursor-pointer hover:bg-gray-100 text-sm"
                    onClick={() => {
                      handleFilterChange('category', '');
                      setCategorySearch('');
                      setShowCategoryDropdown(false);
                    }}
                  >
                    All Categories
                  </div>
                  {filteredCategories.map((cat) => {
                    return (
                      <div
                        key={cat.id}
                        className="px-4 py-2 cursor-pointer hover:bg-gray-100 text-sm"
                        onClick={() => {
                          handleFilterChange('category', cat.id.toString());
                          setCategorySearch(cat.name);
                          setShowCategoryDropdown(false);
                        }}
                      >
                        {cat.name}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="relative">
              <label className="block text-sm font-medium text-gray-700 mb-1">Employee</label>
              <input
                type="text"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Search employee..."
                value={employeeSearch}
                onChange={(e) => {
                  setEmployeeSearch(e.target.value);
                  setShowEmployeeDropdown(true);
                  if (!e.target.value) {
                    handleFilterChange('employee', '');
                  }
                }}
                onFocus={() => setShowEmployeeDropdown(true)}
                onBlur={() => setTimeout(() => setShowEmployeeDropdown(false), 200)}
              />
              {showEmployeeDropdown && filteredEmployees.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                  <div
                    className="px-4 py-2 cursor-pointer hover:bg-gray-100 text-sm"
                    onClick={() => {
                      handleFilterChange('employee', '');
                      setEmployeeSearch('');
                      setShowEmployeeDropdown(false);
                    }}
                  >
                    All Employees
                  </div>
                  {filteredEmployees.map((emp) => (
                    <div
                      key={emp.id}
                      className="px-4 py-2 cursor-pointer hover:bg-gray-100 text-sm"
                      onClick={() => {
                        handleFilterChange('employee', emp.id.toString());
                        setEmployeeSearch(emp.name);
                        setShowEmployeeDropdown(false);
                      }}
                    >
                      {emp.name}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="relative">
              <label className="block text-sm font-medium text-gray-700 mb-1">Language</label>
              <input
                type="text"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Search language..."
                value={languageSearch}
                onChange={(e) => {
                  setLanguageSearch(e.target.value);
                  setShowLanguageDropdown(true);
                  if (!e.target.value) {
                    handleFilterChange('language', '');
                  }
                }}
                onFocus={() => setShowLanguageDropdown(true)}
                onBlur={() => setTimeout(() => setShowLanguageDropdown(false), 200)}
              />
              {showLanguageDropdown && filteredLanguages.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                  <div
                    className="px-4 py-2 cursor-pointer hover:bg-gray-100 text-sm"
                    onClick={() => {
                      handleFilterChange('language', '');
                      setLanguageSearch('');
                      setShowLanguageDropdown(false);
                    }}
                  >
                    All Languages
                  </div>
                  {filteredLanguages.map((lang) => (
                    <div
                      key={lang.id}
                      className="px-4 py-2 cursor-pointer hover:bg-gray-100 text-sm"
                      onClick={() => {
                        handleFilterChange('language', lang.id);
                        setLanguageSearch(lang.name);
                        setShowLanguageDropdown(false);
                      }}
                    >
                      {lang.name}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="mt-4">
            <button
              onClick={() => handleSearch(true)} // Pass true to apply date filters when Show is clicked
              disabled={isSearching}
              className="px-6 py-2 text-white rounded-md hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              style={{ backgroundColor: '#411CCF' }}
            >
              {isSearching ? 'Searching...' : 'Show'}
            </button>
          </div>
        </div>

        {/* Results Table - Inside same white box */}
        {searchPerformed && (
          <div className="border-t border-gray-200 pt-6 -mx-2">
            <div className="mb-4 px-4">
              <h3 className="text-lg font-semibold">Total leads: {results.length}</h3>
            </div>
            {results.length === 0 ? (
              <div className="p-6 text-center text-gray-500">No leads found</div>
            ) : (
              <div className="overflow-x-auto px-4">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ maxWidth: '200px' }}>Lead</th>
                      <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Stage</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Probability</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Scheduler</th>
                      <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ maxWidth: '200px' }}>Expert Opinion</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Total Applicants</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Potential Applicants</th>
                      <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ maxWidth: '200px' }}>Manager Notes</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Total</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {results.map((lead, index) => (
                      <tr key={lead.id || index} className="hover:bg-gray-50">
                        <td className="px-4 py-4" style={{ maxWidth: '200px' }}>
                          <div 
                            className="text-sm font-medium text-blue-600 cursor-pointer hover:underline break-words"
                            onClick={() => navigate(`/clients/${lead.lead_number}`)}
                          >
                            #{lead.lead_number}
                          </div>
                          <div className="text-sm text-gray-900 break-words" style={{ 
                            display: '-webkit-box',
                            WebkitLineClamp: 3,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                            wordBreak: 'break-word'
                          }}>{lead.name || '---'}</div>
                        </td>
                        <td className="px-2 py-4 text-sm text-gray-900">
                          <div className="break-words max-w-[120px] sm:max-w-none sm:whitespace-nowrap line-clamp-2 sm:line-clamp-none">
                          {lead.stage || '---'}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {lead.probability ? `${lead.probability}%` : '---'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {lead.scheduler || '---'}
                        </td>
                        <td className="px-3 py-4 text-sm text-gray-900 max-w-[200px]">
                          <div 
                            className="line-clamp-3 break-words cursor-help"
                            title={lead.expert_opinion && lead.expert_opinion !== '---' ? lead.expert_opinion : undefined}
                          >
                          {lead.expert_opinion || '---'}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {lead.number_of_applicants_meeting ?? '---'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {lead.potential_applicants_meeting ?? '---'}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-900 max-w-xs">
                          {editingManagerNotes[lead.id || index] ? (
                            <div className="flex flex-col gap-2">
                              <textarea
                                value={managerNotesValues[lead.id || index] || lead.manager_notes || ''}
                                onChange={(e) => setManagerNotesValues(prev => ({ ...prev, [lead.id || index]: e.target.value }))}
                                className="textarea textarea-bordered textarea-sm w-full min-h-[60px]"
                                placeholder="Enter manager notes..."
                              />
                              <div className="flex gap-2">
                                <button
                                  onClick={() => handleSaveManagerNotes(lead)}
                                  disabled={savingManagerNotes[lead.id || index]}
                                  className="btn btn-xs btn-primary"
                                >
                                  {savingManagerNotes[lead.id || index] ? 'Saving...' : 'Save'}
                                </button>
                                <button
                                  onClick={() => {
                                    setEditingManagerNotes(prev => {
                                      const newState = { ...prev };
                                      delete newState[lead.id || index];
                                      return newState;
                                    });
                                    setManagerNotesValues(prev => {
                                      const newState = { ...prev };
                                      delete newState[lead.id || index];
                                      return newState;
                                    });
                                  }}
                                  className="btn btn-xs btn-ghost"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-start gap-2 group">
                              <div 
                                className="line-clamp-3 break-words flex-1 cursor-help"
                                title={lead.manager_notes && lead.manager_notes !== '---' ? lead.manager_notes : undefined}
                              >
                                {lead.manager_notes || '---'}
                              </div>
                              <button
                                onClick={() => {
                                  setEditingManagerNotes(prev => ({ ...prev, [lead.id || index]: true }));
                                  setManagerNotesValues(prev => ({ ...prev, [lead.id || index]: lead.manager_notes || '' }));
                                }}
                                className="btn btn-xs btn-ghost opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                                title="Edit manager notes"
                              >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                              </button>
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {formatCurrency(lead.balance, lead.balance_currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
    </div>
  );
};

const CloserSuperPipelineReport = () => {
  const navigate = useNavigate();
  const today = new Date().toISOString().split('T')[0];
  const [filters, setFilters] = useState({
    fromDate: today,
    toDate: today,
    category: '',
    employee: '',
    language: '',
  });
  const [results, setResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchPerformed, setSearchPerformed] = useState(false);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [employees, setEmployees] = useState<{ id: number; name: string }[]>([]);
  const [languages, setLanguages] = useState<{ id: string; name: string }[]>([]);
  const [editingManagerNotes, setEditingManagerNotes] = useState<Record<string, boolean>>({});
  const [managerNotesValues, setManagerNotesValues] = useState<Record<string, string>>({});
  const [savingManagerNotes, setSavingManagerNotes] = useState<Record<string, boolean>>({});
  const [categorySearch, setCategorySearch] = useState<string>('');
  const [employeeSearch, setEmployeeSearch] = useState<string>('');
  const [languageSearch, setLanguageSearch] = useState<string>('');
  const [showCategoryDropdown, setShowCategoryDropdown] = useState<boolean>(false);
  const [showEmployeeDropdown, setShowEmployeeDropdown] = useState<boolean>(false);
  const [showLanguageDropdown, setShowLanguageDropdown] = useState<boolean>(false);

  useEffect(() => {
    const fetchOptions = async () => {
      // Fetch categories
      const { data: catData } = await supabase
        .from('misc_maincategory')
        .select('id, name')
        .order('name');
      if (catData) {
        setCategories(catData.map(cat => ({ id: cat.id.toString(), name: cat.name })));
      }

      // No need to fetch all categories - we only use main categories

      // Fetch employees
      const { data: empData } = await supabase
        .from('tenants_employee')
        .select('id, display_name')
        .order('display_name');
      if (empData) {
        setEmployees(empData.map(emp => ({ id: emp.id, name: emp.display_name || `Employee #${emp.id}` })));
      }

      // Fetch languages
      const { data: langData } = await supabase
        .from('misc_language')
        .select('id, name')
        .order('name');
      if (langData) {
        setLanguages(langData.map(lang => ({ id: lang.id.toString(), name: lang.name })));
      }
    };
    fetchOptions();
  }, []);

  const handleFilterChange = (field: string, value: any) => {
    setFilters(prev => ({ ...prev, [field]: value }));
  };

  const getCategoryName = (categoryId: string | number | null | undefined, fallbackCategory?: string | number) => {
    // For display purposes, we'll show a simple category name
    // This function is used for displaying category names in the results
    if (!categoryId || categoryId === '---' || categoryId === '--') {
      return '---';
    }

    // Try to find the main category by looking up subcategories
    // For now, return a simple display - this can be enhanced if needed
    return fallbackCategory ? String(fallbackCategory) : '---';
  };

  const getStageName = (stageId: string | number | null | undefined) => {
    if (!stageId) return '---';
    // Stage names mapping - you may need to fetch from lead_stages table
    const stageMap: Record<string, string> = {
      '0': 'Created',
      '10': 'Scheduler assigned',
      '11': 'Precommunication',
      '15': 'Communication started',
      '20': 'Meeting scheduled',
      '21': 'Meeting rescheduling',
      '30': 'Meeting complete',
      '35': 'Meeting Irrelevant',
      '40': 'Waiting for Mtng sum',
      '50': 'Mtng sum+Agreement sent',
      '51': 'Client declined price offer',
      '55': 'Another meeting',
      '60': 'Client signed agreement',
      '70': 'Payment request sent',
      '91': 'Dropped (Spam/Irrelevant)',
      '100': 'Success',
      '105': 'Handler Set',
      '110': 'Handler Started',
      '150': 'Application submitted',
      '200': 'Case Closed'
    };
    return stageMap[String(stageId)] || String(stageId);
  };

  const formatCurrency = (amount: number | null | undefined, currency: string | null | undefined) => {
    if (!amount) return '---';
    const symbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : currency === 'NIS' ? '₪' : currency || '';
    return `${symbol} ${amount.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
  };

  const formatNoteText = (text: string): string => {
    if (!text) return '';
    return text.replace(/\n/g, '<br>');
  };

  const fetchCurrentUserName = async (): Promise<string> => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: userRow } = await supabase
          .from('users')
          .select('full_name')
          .eq('auth_id', user.id)
          .maybeSingle();
        if (userRow?.full_name) {
          return userRow.full_name;
        }
        if (user.user_metadata?.full_name) {
          return user.user_metadata.full_name;
        }
        if (user.email) {
          return user.email;
        }
      }
      return 'Unknown User';
    } catch (error) {
      console.error('Error fetching current user name:', error);
      return 'Unknown User';
    }
  };

  const handleSaveManagerNotes = async (lead: any) => {
    const leadId = lead.id || lead.lead_number;
    if (!leadId) return;

    setSavingManagerNotes(prev => ({ ...prev, [lead.id || lead.lead_number]: true }));
    try {
      const userName = await fetchCurrentUserName();
      const tableName = lead.lead_type === 'legacy' ? 'leads_lead' : 'leads';
      const clientId = lead.lead_type === 'legacy' 
        ? (typeof leadId === 'string' ? parseInt(leadId.replace('legacy_', '')) : leadId)
        : leadId;

      const notesText = managerNotesValues[lead.id || lead.lead_number] || '';
      const updateData: any = {
        management_notes: formatNoteText(notesText),
        management_notes_last_edited_by: userName,
        management_notes_last_edited_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from(tableName)
        .update(updateData)
        .eq('id', clientId);

      if (error) throw error;

      // Update local state
      setResults(prev => prev.map(l => 
        l.id === lead.id 
          ? { ...l, manager_notes: formatNoteText(notesText) }
          : l
      ));

      // Clear editing state
      setEditingManagerNotes(prev => {
        const newState = { ...prev };
        delete newState[lead.id || lead.lead_number];
        return newState;
      });
      setManagerNotesValues(prev => {
        const newState = { ...prev };
        delete newState[lead.id || lead.lead_number];
        return newState;
      });

      toast.success('Manager notes saved successfully');
    } catch (error: any) {
      console.error('Error saving manager notes:', error);
      toast.error(`Failed to save manager notes: ${error?.message || 'Unknown error'}`);
    } finally {
      setSavingManagerNotes(prev => {
        const newState = { ...prev };
        delete newState[lead.id || lead.lead_number];
        return newState;
      });
    }
  };

  const handleSearch = async (applyDateFilters: boolean = true) => {
    setIsSearching(true);
    if (applyDateFilters) {
      setSearchPerformed(true);
    }
    try {
      const allLeads: any[] = [];

      // Closer pipeline allowed stages: only stage 40 (Waiting for Mtng sum) and 50 (Mtng sum+Agreement sent)
      const allowedStageIds = ['40', '50'];

      // Fetch new leads
      let newLeadsQuery = supabase
        .from('leads')
        .select(`
          id,
          lead_number,
          name,
          created_at,
          closer,
          scheduler,
          expert,
          manager,
          category,
          category_id,
          stage,
          probability,
          language,
          number_of_applicants_meeting,
          potential_applicants_meeting,
          balance,
          balance_currency,
          expert_notes,
          management_notes,
          unactivated_at
        `)
        .gte('probability', 80) // Only probability >= 80%
        .not('probability', 'is', null) // Exclude null probabilities
        .not('closer', 'is', null) // Only leads with closer assigned
        .is('unactivated_at', null); // Only active leads (closer pipeline doesn't check eligible)

      // Apply stage filter for closers
      newLeadsQuery = newLeadsQuery.in('stage', allowedStageIds);

      // Apply date filter only when explicitly requested (when Show is clicked)
      if (applyDateFilters) {
        if (filters.fromDate) {
          newLeadsQuery = newLeadsQuery.gte('created_at', filters.fromDate);
        }
        if (filters.toDate) {
          newLeadsQuery = newLeadsQuery.lte('created_at', filters.toDate);
        }
      }

      // Apply category filter (main category - need to filter by all subcategories)
      if (filters.category) {
        // Fetch all subcategories for this main category
        const { data: subCategories } = await supabase
          .from('misc_category')
          .select('id')
          .eq('parent_id', filters.category);
        
        if (subCategories && subCategories.length > 0) {
          const subCategoryIds = subCategories.map(sc => sc.id.toString());
          newLeadsQuery = newLeadsQuery.in('category_id', subCategoryIds);
        } else {
          // If no subcategories found, return no results
          newLeadsQuery = newLeadsQuery.eq('category_id', -1); // Non-existent ID
        }
      }

      // Apply language filter
      if (filters.language) {
        newLeadsQuery = newLeadsQuery.eq('language', filters.language);
      }

      // Apply employee filter (closer)
      if (filters.employee) {
        const employee = employees.find(emp => emp.id.toString() === filters.employee);
        if (employee) {
          newLeadsQuery = newLeadsQuery.eq('closer', employee.name);
        }
      }

      const { data: newLeads, error: newLeadsError } = await newLeadsQuery.order('created_at', { ascending: false });

      if (newLeadsError) {
        console.error('Error fetching new leads:', newLeadsError);
        // Continue with empty array - will still try to fetch legacy leads
      }
      
      if (newLeads) {
        newLeads.forEach((lead: any) => {
          // Convert expert_notes array to string
          let expertOpinionText = '---';
          if (lead.expert_notes) {
            if (Array.isArray(lead.expert_notes)) {
              expertOpinionText = lead.expert_notes
                .map((note: any) => note?.content || note)
                .filter(Boolean)
                .join('; ') || '---';
            } else if (typeof lead.expert_notes === 'string') {
              expertOpinionText = lead.expert_notes;
            } else if (lead.expert_notes?.content) {
              expertOpinionText = lead.expert_notes.content;
            }
          }

          // Convert management_notes to string
          let managerNotesText = '---';
          if (lead.management_notes) {
            if (Array.isArray(lead.management_notes)) {
              managerNotesText = lead.management_notes
                .map((note: any) => note?.content || note)
                .filter(Boolean)
                .join('; ') || '---';
            } else if (typeof lead.management_notes === 'string') {
              managerNotesText = lead.management_notes;
            } else if (lead.management_notes?.content) {
              managerNotesText = lead.management_notes.content;
            }
          }

          allLeads.push({
            ...lead,
            lead_type: 'new',
            stage: getStageName(lead.stage), // Convert stage ID to name
            expert_opinion: expertOpinionText,
            manager_notes: managerNotesText,
            scheduler: lead.scheduler || '---', // Include scheduler for closer pipeline
          });
        });
      }

      // Fetch legacy leads
      // Closer pipeline allowed legacy stages: only stage 40 (Waiting for Mtng sum) and 50 (Mtng sum+Agreement sent)
      const allowedLegacyStageIds = [40, 50];
      
      let legacyLeadsQuery = supabase
        .from('leads_lead')
        .select(`
          id,
          name,
          cdate,
          closer_id,
          meeting_scheduler_id,
          expert_id,
          meeting_manager_id,
          category_id,
          stage,
          probability,
          language_id,
          no_of_applicants,
          potential_applicants,
          total,
          currency_id,
          expert_notes,
          management_notes
        `)
        .gte('probability', 80) // Only probability >= 80%
        .not('probability', 'is', null) // Exclude null probabilities
        .not('closer_id', 'is', null) // Only leads with closer assigned
        .eq('status', 0) // Only active leads
        .in('stage', allowedLegacyStageIds); // Only closer pipeline stages (NO eligible filter for closers)

      // Apply date filter only when explicitly requested (when Show is clicked)
      if (applyDateFilters) {
        if (filters.fromDate) {
          legacyLeadsQuery = legacyLeadsQuery.gte('cdate', filters.fromDate);
        }
        if (filters.toDate) {
          legacyLeadsQuery = legacyLeadsQuery.lte('cdate', filters.toDate);
        }
      }

      // Apply category filter (main category - need to filter by all subcategories)
      if (filters.category) {
        // Fetch all subcategories for this main category
        const { data: subCategories } = await supabase
          .from('misc_category')
          .select('id')
          .eq('parent_id', filters.category);
        
        if (subCategories && subCategories.length > 0) {
          const subCategoryIds = subCategories.map(sc => sc.id);
          legacyLeadsQuery = legacyLeadsQuery.in('category_id', subCategoryIds);
        } else {
          // If no subcategories found, return no results
          legacyLeadsQuery = legacyLeadsQuery.eq('category_id', -1); // Non-existent ID
        }
      }

      // Apply language filter
      if (filters.language) {
        legacyLeadsQuery = legacyLeadsQuery.eq('language_id', Number(filters.language));
      }

      // Apply employee filter (closer)
      if (filters.employee) {
        legacyLeadsQuery = legacyLeadsQuery.eq('closer_id', Number(filters.employee));
      }

      const { data: legacyLeads, error: legacyLeadsError } = await legacyLeadsQuery.order('cdate', { ascending: false });

      if (legacyLeadsError) {
        console.error('Error fetching legacy leads:', legacyLeadsError);
        // Continue with empty array instead of breaking
        setResults([]);
        setIsSearching(false);
        return;
      }
      
      if (legacyLeads) {
        // Fetch closer names for legacy leads
        const closerIds = [...new Set(legacyLeads.map((l: any) => l.closer_id).filter(Boolean))];
        const closerMap: Record<number, string> = {};
        
        if (closerIds.length > 0) {
          const { data: closerData } = await supabase
            .from('tenants_employee')
            .select('id, display_name')
            .in('id', closerIds);
          
          if (closerData) {
            closerData.forEach((emp: any) => {
              closerMap[emp.id] = emp.display_name || `Employee #${emp.id}`;
            });
          }
        }

        // Fetch scheduler names for legacy leads
        const schedulerIds = [...new Set(legacyLeads.map((l: any) => l.meeting_scheduler_id).filter(Boolean))];
        const schedulerMap: Record<number, string> = {};
        
        if (schedulerIds.length > 0) {
          const { data: schedulerData } = await supabase
            .from('tenants_employee')
            .select('id, display_name')
            .in('id', schedulerIds);
          
          if (schedulerData) {
            schedulerData.forEach((emp: any) => {
              schedulerMap[emp.id] = emp.display_name || `Employee #${emp.id}`;
            });
          }
        }

        // Fetch currency codes
        const currencyIds = [...new Set(legacyLeads.map((l: any) => l.currency_id).filter(Boolean))];
        const currencyMap: Record<number, string> = {};
        
        if (currencyIds.length > 0) {
          const { data: currencyData } = await supabase
            .from('accounting_currencies')
            .select('id, iso_code')
            .in('id', currencyIds);
          
          if (currencyData) {
            currencyData.forEach((curr: any) => {
              currencyMap[curr.id] = curr.iso_code || '';
            });
          }
        }

        // Fetch language names for legacy leads
        const languageIds = [...new Set(legacyLeads.map((l: any) => l.language_id).filter(Boolean))];
        const languageMap: Record<number, string> = {};
        
        if (languageIds.length > 0) {
          const { data: languageData } = await supabase
            .from('misc_language')
            .select('id, name')
            .in('id', languageIds);
          
          if (languageData) {
            languageData.forEach((lang: any) => {
              languageMap[lang.id] = lang.name || '';
            });
          }
        }

        legacyLeads.forEach((lead: any) => {
          // Convert expert_notes array to string
          let expertOpinionText = '---';
          if (lead.expert_notes) {
            if (Array.isArray(lead.expert_notes)) {
              expertOpinionText = lead.expert_notes
                .map((note: any) => note?.content || note)
                .filter(Boolean)
                .join('; ') || '---';
            } else if (typeof lead.expert_notes === 'string') {
              expertOpinionText = lead.expert_notes;
            } else if (lead.expert_notes?.content) {
              expertOpinionText = lead.expert_notes.content;
            }
          }

          // Convert management_notes to string
          let managerNotesText = '---';
          if (lead.management_notes) {
            if (Array.isArray(lead.management_notes)) {
              managerNotesText = lead.management_notes
                .map((note: any) => note?.content || note)
                .filter(Boolean)
                .join('; ') || '---';
            } else if (typeof lead.management_notes === 'string') {
              managerNotesText = lead.management_notes;
            } else if (lead.management_notes?.content) {
              managerNotesText = lead.management_notes.content;
            }
          }

          allLeads.push({
            id: `legacy_${lead.id}`,
            lead_number: lead.id?.toString() || '',
            name: lead.name || '',
            created_at: lead.cdate || new Date().toISOString(),
            closer: closerMap[lead.closer_id] || `Employee #${lead.closer_id}`,
            scheduler: schedulerMap[lead.meeting_scheduler_id] || (lead.meeting_scheduler_id ? `Employee #${lead.meeting_scheduler_id}` : '---'),
            expert: lead.expert_id ? `Expert #${lead.expert_id}` : null,
            manager: lead.meeting_manager_id ? `Manager #${lead.meeting_manager_id}` : null,
            category: getCategoryName(lead.category_id),
            category_id: lead.category_id,
            stage: getStageName(lead.stage),
            probability: lead.probability || 0,
            language: lead.language_id ? (languageMap[lead.language_id] || `Language #${lead.language_id}`) : null,
            number_of_applicants_meeting: lead.no_of_applicants || 0,
            potential_applicants_meeting: lead.potential_applicants || 0,
            balance: lead.total || 0,
            balance_currency: currencyMap[lead.currency_id] || null,
            expert_opinion: expertOpinionText,
            manager_notes: managerNotesText,
            lead_type: 'legacy',
          });
        });
      }

      // Sort by probability (highest first), then by created_at (newest first)
      const sortedLeads = allLeads.sort((a, b) => {
        const probA = a.probability || 0;
        const probB = b.probability || 0;
        if (probB !== probA) {
          return probB - probA; // Higher probability first
        }
        // If probabilities are equal, sort by created_at (newest first)
        const dateA = new Date(a.created_at || 0).getTime();
        const dateB = new Date(b.created_at || 0).getTime();
        return dateB - dateA;
      });
      
      setResults(sortedLeads);
    } catch (error: any) {
      console.error('Error in CloserSuperPipelineReport:', error);
      toast.error(`Error fetching leads: ${error?.message || 'Unknown error'}`);
      setResults([]); // Set empty results on error
    } finally {
      setIsSearching(false);
    }
  };

  // Automatically load all leads on component mount (without date filters)
  useEffect(() => {
    handleSearch(false); // Pass false to skip date filters on initial load
    setSearchPerformed(true); // Show the table with initial results
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty dependency array means this runs once on mount

  // Sync search inputs with selected filters
  useEffect(() => {
    if (filters.category) {
      const selectedCategory = categories.find(cat => cat.id.toString() === filters.category);
      setCategorySearch(selectedCategory ? selectedCategory.name : '');
    } else {
      setCategorySearch('');
    }
  }, [filters.category, categories]);

  useEffect(() => {
    if (filters.employee) {
      const selectedEmployee = employees.find(emp => emp.id.toString() === filters.employee);
      setEmployeeSearch(selectedEmployee ? selectedEmployee.name : '');
    } else {
      setEmployeeSearch('');
    }
  }, [filters.employee, employees]);

  useEffect(() => {
    if (filters.language) {
      const selectedLanguage = languages.find(lang => lang.id === filters.language);
      setLanguageSearch(selectedLanguage ? selectedLanguage.name : '');
    } else {
      setLanguageSearch('');
    }
  }, [filters.language, languages]);

  // Filter options based on search
  const filteredCategories = categories.filter((cat: any) => {
    const searchTerm = categorySearch.toLowerCase();
    const catName = cat.name?.toLowerCase() || '';
    return catName.includes(searchTerm);
  });

  const filteredEmployees = employees.filter((emp: any) => 
    emp.name.toLowerCase().includes(employeeSearch.toLowerCase())
  );

  const filteredLanguages = languages.filter((lang: any) => 
    lang.name.toLowerCase().includes(languageSearch.toLowerCase())
  );

  return (
    <div className="px-2 py-6">
      <h2 className="text-2xl font-bold mb-6 px-4">Closer Super Pipeline</h2>
      
        {/* Filters */}
      <div className="mb-6 px-4">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">From Date</label>
            <input
              type="date"
              value={filters.fromDate}
              onChange={(e) => handleFilterChange('fromDate', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">To Date</label>
              <input
                type="date"
                value={filters.toDate}
                onChange={(e) => handleFilterChange('toDate', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="relative">
              <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
              <input
                type="text"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Search category..."
                value={categorySearch}
                onChange={(e) => {
                  setCategorySearch(e.target.value);
                  setShowCategoryDropdown(true);
                  if (!e.target.value) {
                    handleFilterChange('category', '');
                  }
                }}
                onFocus={() => setShowCategoryDropdown(true)}
                onBlur={() => setTimeout(() => setShowCategoryDropdown(false), 200)}
              />
              {showCategoryDropdown && filteredCategories.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                  <div
                    className="px-4 py-2 cursor-pointer hover:bg-gray-100 text-sm"
                    onClick={() => {
                      handleFilterChange('category', '');
                      setCategorySearch('');
                      setShowCategoryDropdown(false);
                    }}
                  >
                    All Categories
                  </div>
                  {filteredCategories.map((cat) => {
                    return (
                      <div
                        key={cat.id}
                        className="px-4 py-2 cursor-pointer hover:bg-gray-100 text-sm"
                        onClick={() => {
                          handleFilterChange('category', cat.id.toString());
                          setCategorySearch(cat.name);
                          setShowCategoryDropdown(false);
                        }}
                      >
                        {cat.name}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="relative">
              <label className="block text-sm font-medium text-gray-700 mb-1">Employee</label>
              <input
                type="text"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Search employee..."
                value={employeeSearch}
                onChange={(e) => {
                  setEmployeeSearch(e.target.value);
                  setShowEmployeeDropdown(true);
                  if (!e.target.value) {
                    handleFilterChange('employee', '');
                  }
                }}
                onFocus={() => setShowEmployeeDropdown(true)}
                onBlur={() => setTimeout(() => setShowEmployeeDropdown(false), 200)}
              />
              {showEmployeeDropdown && filteredEmployees.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                  <div
                    className="px-4 py-2 cursor-pointer hover:bg-gray-100 text-sm"
                    onClick={() => {
                      handleFilterChange('employee', '');
                      setEmployeeSearch('');
                      setShowEmployeeDropdown(false);
                    }}
                  >
                    All Employees
                  </div>
                  {filteredEmployees.map((emp) => (
                    <div
                      key={emp.id}
                      className="px-4 py-2 cursor-pointer hover:bg-gray-100 text-sm"
                      onClick={() => {
                        handleFilterChange('employee', emp.id.toString());
                        setEmployeeSearch(emp.name);
                        setShowEmployeeDropdown(false);
                      }}
                    >
                      {emp.name}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="relative">
              <label className="block text-sm font-medium text-gray-700 mb-1">Language</label>
              <input
                type="text"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Search language..."
                value={languageSearch}
                onChange={(e) => {
                  setLanguageSearch(e.target.value);
                  setShowLanguageDropdown(true);
                  if (!e.target.value) {
                    handleFilterChange('language', '');
                  }
                }}
                onFocus={() => setShowLanguageDropdown(true)}
                onBlur={() => setTimeout(() => setShowLanguageDropdown(false), 200)}
              />
              {showLanguageDropdown && filteredLanguages.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                  <div
                    className="px-4 py-2 cursor-pointer hover:bg-gray-100 text-sm"
                    onClick={() => {
                      handleFilterChange('language', '');
                      setLanguageSearch('');
                      setShowLanguageDropdown(false);
                    }}
                  >
                    All Languages
                  </div>
                  {filteredLanguages.map((lang) => (
                    <div
                      key={lang.id}
                      className="px-4 py-2 cursor-pointer hover:bg-gray-100 text-sm"
                      onClick={() => {
                        handleFilterChange('language', lang.id);
                        setLanguageSearch(lang.name);
                        setShowLanguageDropdown(false);
                      }}
                    >
                      {lang.name}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="mt-4">
            <button
              onClick={() => handleSearch(true)} // Pass true to apply date filters when Show is clicked
              disabled={isSearching}
              className="px-6 py-2 text-white rounded-md hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              style={{ backgroundColor: '#411CCF' }}
            >
              {isSearching ? 'Searching...' : 'Show'}
            </button>
          </div>
        </div>

        {/* Results Table - Inside same white box */}
        {searchPerformed && (
          <div className="border-t border-gray-200 pt-6 -mx-2">
            <div className="mb-4 px-4">
              <h3 className="text-lg font-semibold">Total leads: {results.length}</h3>
            </div>
            {results.length === 0 ? (
              <div className="p-6 text-center text-gray-500">No leads found</div>
            ) : (
              <div className="overflow-x-auto px-4">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ maxWidth: '200px' }}>Lead</th>
                      <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Stage</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Probability</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Closer</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Scheduler</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ maxWidth: '200px' }}>Expert Opinion</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Total Applicants</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Potential Applicants</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ maxWidth: '200px' }}>Manager Notes</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Total</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {results.map((lead, index) => (
                    <tr key={lead.id || index} className="hover:bg-gray-50">
                        <td className="px-4 py-4" style={{ maxWidth: '200px' }}>
                        <div 
                            className="text-sm font-medium text-blue-600 cursor-pointer hover:underline break-words"
                          onClick={() => navigate(`/clients/${lead.lead_number}`)}
                        >
                          #{lead.lead_number}
                        </div>
                          <div className="text-sm text-gray-900 break-words" style={{ 
                            display: '-webkit-box',
                            WebkitLineClamp: 3,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                            wordBreak: 'break-word'
                          }}>{lead.name || '---'}</div>
                      </td>
                        <td className="px-2 py-4 text-sm text-gray-900">
                          <div className="break-words max-w-[120px] sm:max-w-none sm:whitespace-nowrap line-clamp-2 sm:line-clamp-none">
                        {lead.stage || '---'}
                          </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {lead.probability ? `${lead.probability}%` : '---'}
                      </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {lead.closer || '---'}
                        </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {lead.scheduler || '---'}
                      </td>
                      <td className="px-3 py-4 text-sm text-gray-900 max-w-[200px]">
                        <div 
                          className="line-clamp-3 break-words cursor-help"
                          title={lead.expert_opinion && lead.expert_opinion !== '---' ? lead.expert_opinion : undefined}
                        >
                        {lead.expert_opinion || '---'}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {lead.number_of_applicants_meeting ?? '---'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {lead.potential_applicants_meeting ?? '---'}
                      </td>
                        <td className="px-3 py-4 text-sm text-gray-900 max-w-[200px]">
                          {editingManagerNotes[lead.id || index] ? (
                            <div className="flex flex-col gap-2">
                              <textarea
                                value={managerNotesValues[lead.id || index] || lead.manager_notes || ''}
                                onChange={(e) => setManagerNotesValues(prev => ({ ...prev, [lead.id || index]: e.target.value }))}
                                className="textarea textarea-bordered textarea-sm w-full min-h-[60px]"
                                placeholder="Enter manager notes..."
                              />
                              <div className="flex gap-2">
                                <button
                                  onClick={() => handleSaveManagerNotes(lead)}
                                  disabled={savingManagerNotes[lead.id || index]}
                                  className="btn btn-xs btn-primary"
                                >
                                  {savingManagerNotes[lead.id || index] ? 'Saving...' : 'Save'}
                                </button>
                                <button
                                  onClick={() => {
                                    setEditingManagerNotes(prev => {
                                      const newState = { ...prev };
                                      delete newState[lead.id || index];
                                      return newState;
                                    });
                                    setManagerNotesValues(prev => {
                                      const newState = { ...prev };
                                      delete newState[lead.id || index];
                                      return newState;
                                    });
                                  }}
                                  className="btn btn-xs btn-ghost"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-start gap-2 group">
                              <div 
                                className="line-clamp-3 break-words flex-1 cursor-help"
                                title={lead.manager_notes && lead.manager_notes !== '---' ? lead.manager_notes : undefined}
                              >
                                {lead.manager_notes || '---'}
                              </div>
                              <button
                                onClick={() => {
                                  setEditingManagerNotes(prev => ({ ...prev, [lead.id || index]: true }));
                                  setManagerNotesValues(prev => ({ ...prev, [lead.id || index]: lead.manager_notes || '' }));
                                }}
                                className="btn btn-xs btn-ghost opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                                title="Edit manager notes"
                              >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                              </button>
                            </div>
                          )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {formatCurrency(lead.balance, lead.balance_currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const SuperPipelineSchedulersReport = () => <div className="p-6">Super Pipeline (Schedulers) Report Content</div>;
const SchedulersQualityReport = () => <div className="p-6">Schedulers Quality Report Content</div>;
const PerformanceReport = () => <div className="p-6">Schedulers Performance Report Content</div>;
const PerformanceByCatReport = () => <div className="p-6">Schedulers Performance by Cat. Report Content</div>;
const SuperPipelineClosersReport = CloserSuperPipelineReport;
const ClosersQualityReport = () => <div className="p-6">Closers Quality Report Content</div>;
const ExpertsAssignmentReport = () => <div className="p-6">Experts Assignment Report Content</div>;
const ExpertsResultsReport = () => {
  const navigate = useNavigate();
  const today = new Date().toISOString().split('T')[0];
  const [filters, setFilters] = usePersistedFilters('reports_expertsResults_filters', {
    fromDate: today,
    toDate: today,
    stage: '',
    language: '',
    category: '',
    expertExamination: '',
    expert: '',
    source: '',
  }, {
    storage: 'sessionStorage',
  });
  const [results, setResults] = usePersistedFilters<any[]>('reports_expertsResults_results', [], {
    storage: 'sessionStorage',
  });
  const [isSearching, setIsSearching] = useState(false);
  const [searchPerformed, setSearchPerformed] = usePersistedFilters('reports_expertsResults_performed', false, {
    storage: 'sessionStorage',
  });
  const [stages, setStages] = useState<{ id: number; name: string }[]>([]);
  const [languages, setLanguages] = useState<{ id: number; name: string }[]>([]);
  const [categories, setCategories] = useState<{ id: number; name: string }[]>([]);
  const [employees, setEmployees] = useState<{ id: number; name: string }[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [allCategories, setAllCategories] = useState<any[]>([]);
  const [employeeNameMap, setEmployeeNameMap] = useState<Record<number, string>>({});
  
  // Search states for searchable dropdowns
  const [stageSearch, setStageSearch] = useState<string>('');
  const [languageSearch, setLanguageSearch] = useState<string>('');
  const [categorySearch, setCategorySearch] = useState<string>('');
  const [expertExaminationSearch, setExpertExaminationSearch] = useState<string>('');
  const [expertSearch, setExpertSearch] = useState<string>('');
  const [sourceSearch, setSourceSearch] = useState<string>('');
  
  // Dropdown visibility states
  const [showStageDropdown, setShowStageDropdown] = useState<boolean>(false);
  const [showLanguageDropdown, setShowLanguageDropdown] = useState<boolean>(false);
  const [showCategoryDropdown, setShowCategoryDropdown] = useState<boolean>(false);
  const [showExpertExaminationDropdown, setShowExpertExaminationDropdown] = useState<boolean>(false);
  const [showExpertDropdown, setShowExpertDropdown] = useState<boolean>(false);
  const [showSourceDropdown, setShowSourceDropdown] = useState<boolean>(false);

  const expertExaminationOptions = [
    { value: '', label: 'Please choose' },
    { value: 'feasible_no_check', label: 'Feasible (No Check)' },
    { value: 'feasible_check', label: 'Feasible (Further Check)' },
    { value: 'not_feasible', label: 'Not Feasible' },
  ];

  useEffect(() => {
    const fetchOptions = async () => {
      // Fetch stages
      const { data: stageData } = await supabase
        .from('lead_stages')
        .select('id, name')
        .order('name');
      if (stageData) {
        setStages(stageData.map(s => ({ id: s.id, name: s.name })));
      }

      // Fetch languages
      const { data: langData } = await supabase
        .from('misc_language')
        .select('id, name')
        .order('name');
      if (langData) {
        setLanguages(langData.map(l => ({ id: l.id, name: l.name })));
      }

      // Fetch main categories
      const { data: catData } = await supabase
        .from('misc_maincategory')
        .select('id, name')
        .order('name');
      if (catData) {
        setCategories(catData.map(c => ({ id: c.id, name: c.name })));
      }

      // Fetch all categories with subcategories for detailed lookup
      const { data: allCatData } = await supabase
        .from('misc_category')
        .select(`
          id,
          name,
          parent_id,
          misc_maincategory!parent_id(
            id,
            name
          )
        `)
        .order('name');
      if (allCatData) {
        setAllCategories(allCatData || []);
      }

      // Fetch employees
      const { data: empData } = await supabase
        .from('tenants_employee')
        .select('id, display_name')
        .order('display_name');
      if (empData) {
        setEmployees(empData.map(emp => ({ id: emp.id, name: emp.display_name || `Employee #${emp.id}` })));
        const nameMap: Record<number, string> = {};
        empData.forEach(emp => {
          if (emp.id && emp.display_name) {
            nameMap[emp.id] = emp.display_name;
          }
        });
        setEmployeeNameMap(nameMap);
      }

      // Fetch sources
      const { data: sourceData } = await supabase
        .from('leads')
        .select('source')
        .not('source', 'is', null)
        .neq('source', '');
      if (sourceData) {
        const uniqueSources = Array.from(new Set(sourceData.map(s => s.source).filter(Boolean))) as string[];
        setSources(uniqueSources.sort());
      }
    };
    fetchOptions();
  }, []);

  const handleFilterChange = (field: string, value: any) => {
    setFilters(prev => ({ ...prev, [field]: value }));
  };

  // Update search text when filter changes
  useEffect(() => {
    if (filters.stage) {
      const selectedStage = stages.find(s => s.id.toString() === filters.stage);
      setStageSearch(selectedStage ? selectedStage.name : '');
    } else {
      setStageSearch('');
    }
  }, [filters.stage, stages]);

  useEffect(() => {
    if (filters.language) {
      const selectedLanguage = languages.find(l => l.id.toString() === filters.language);
      setLanguageSearch(selectedLanguage ? selectedLanguage.name : '');
    } else {
      setLanguageSearch('');
    }
  }, [filters.language, languages]);

  useEffect(() => {
    if (filters.category) {
      const selectedCategory = categories.find(c => c.id.toString() === filters.category);
      setCategorySearch(selectedCategory ? selectedCategory.name : '');
    } else {
      setCategorySearch('');
    }
  }, [filters.category, categories]);

  useEffect(() => {
    if (filters.expertExamination) {
      const selectedOption = expertExaminationOptions.find(opt => opt.value === filters.expertExamination);
      setExpertExaminationSearch(selectedOption ? selectedOption.label : '');
    } else {
      setExpertExaminationSearch('');
    }
  }, [filters.expertExamination]);

  useEffect(() => {
    if (filters.expert) {
      const selectedExpert = employees.find(e => e.id.toString() === filters.expert);
      setExpertSearch(selectedExpert ? selectedExpert.name : '');
    } else {
      setExpertSearch('');
    }
  }, [filters.expert, employees]);

  useEffect(() => {
    if (filters.source) {
      setSourceSearch(filters.source);
    } else {
      setSourceSearch('');
    }
  }, [filters.source]);

  // Filter options based on search
  const filteredStages = stages.filter((stage: { id: number; name: string }) => 
    stage.name.toLowerCase().includes(stageSearch.toLowerCase())
  );

  const filteredLanguages = languages.filter((lang: { id: number; name: string }) => 
    lang.name.toLowerCase().includes(languageSearch.toLowerCase())
  );

  const filteredCategories = categories.filter((cat: { id: number; name: string }) => 
    cat.name.toLowerCase().includes(categorySearch.toLowerCase())
  );

  const filteredExpertExaminations = expertExaminationOptions.filter((opt: { value: string; label: string }) => 
    opt.label.toLowerCase().includes(expertExaminationSearch.toLowerCase())
  );

  const filteredExperts = employees.filter((emp: { id: number; name: string }) => 
    emp.name.toLowerCase().includes(expertSearch.toLowerCase())
  );

  const filteredSources = sources.filter((source: string) => 
    source.toLowerCase().includes(sourceSearch.toLowerCase())
  );

  const getCategoryName = (categoryId: string | number | null | undefined, miscCategory?: any) => {
    if (!categoryId || categoryId === '---' || categoryId === '--') {
      return '---';
    }
    
    if (miscCategory) {
      const cat = Array.isArray(miscCategory) ? miscCategory[0] : miscCategory;
      const mainCategory = Array.isArray(cat?.misc_maincategory) ? cat.misc_maincategory[0] : cat?.misc_maincategory;
      if (mainCategory?.name && cat?.name) {
        return `${cat.name} (${mainCategory.name})`;
      }
      if (cat?.name) {
        return cat.name;
      }
    }

    const foundCategory = allCategories.find((cat: any) => cat.id.toString() === categoryId.toString());
    if (foundCategory) {
      const mainCategory = Array.isArray(foundCategory.misc_maincategory) 
        ? foundCategory.misc_maincategory[0] 
        : foundCategory.misc_maincategory;
      if (mainCategory?.name) {
        return `${foundCategory.name} (${mainCategory.name})`;
      }
      return foundCategory.name;
    }
    
    return String(categoryId);
  };

  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return '---';
    try {
      const date = new Date(dateStr);
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const year = String(date.getFullYear()).slice(-2);
      return `${day}.${month}.${year}`;
    } catch {
      return '---';
    }
  };

  const formatCurrency = (amount: number | null | undefined, currency: string | null | undefined) => {
    if (!amount) return '---';
    const symbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : currency === 'NIS' || currency === 'ILS' ? '₪' : currency || '₪';
    return `${symbol} ${amount.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
  };

  const getExpertExaminationResult = (lead: any): { text: string; color: string } => {
    if (lead.lead_type === 'new') {
      const status = lead.eligibility_status;
      if (status === 'feasible_no_check') {
        return { text: 'Feasible (no check)', color: 'bg-green-100 text-green-800' };
      } else if (status === 'feasible_check') {
        return { text: 'Feasibile (further check)', color: 'bg-yellow-100 text-yellow-800' };
      } else if (status === 'not_feasible') {
        return { text: 'Not feasible', color: 'bg-red-100 text-red-800' };
      }
    } else {
      const exam = String(lead.expert_examination || '');
      if (exam === '8') {
        return { text: 'Feasible (no check)', color: 'bg-green-100 text-green-800' };
      } else if (exam === '5') {
        return { text: 'Feasibile (further check)', color: 'bg-yellow-100 text-yellow-800' };
      } else if (exam === '1') {
        return { text: 'Not feasible', color: 'bg-red-100 text-red-800' };
      }
    }
    return { text: '---', color: 'bg-gray-100 text-gray-800' };
  };

  const resolveEmployeeName = (value: any): string => {
    if (!value) return '---';
    if (typeof value === 'number') {
      return employeeNameMap[value] || `Employee ${value}`;
    }
    const numericValue = parseInt(String(value));
    if (!isNaN(numericValue) && String(numericValue) === String(value).trim()) {
      return employeeNameMap[numericValue] || `Employee ${numericValue}`;
    }
    return String(value);
  };

  const handleSearch = async () => {
    setIsSearching(true);
    setSearchPerformed(true);
    try {
      // Ensure dates are in proper ISO format
      // Date input returns YYYY-MM-DD, but we need to ensure we only use the date part
      const fromDate = filters.fromDate ? (() => {
        // Remove any existing time component and spaces, keep only YYYY-MM-DD
        const cleanDate = filters.fromDate.trim().split('T')[0].split(' ')[0];
        // Validate it's in YYYY-MM-DD format
        if (/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) {
          return `${cleanDate}T00:00:00`;
        }
        return null;
      })() : null;
      const toDate = filters.toDate ? (() => {
        // Remove any existing time component and spaces, keep only YYYY-MM-DD
        const cleanDate = filters.toDate.trim().split('T')[0].split(' ')[0];
        // Validate it's in YYYY-MM-DD format
        if (/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) {
          return `${cleanDate}T23:59:59`;
        }
        return null;
      })() : null;

      // Build query for new leads with expert examination results
      let newLeadsQuery = supabase
        .from('leads')
        .select(`
          id,
          lead_number,
          name,
          category_id,
          category,
          stage,
          language,
          source,
          expert,
          eligibility_status,
          scheduler,
          manager,
          balance,
          balance_currency,
          proposal_total,
          proposal_currency,
          meeting_date,
          misc_category!category_id(
            id,
            name,
            parent_id,
            misc_maincategory!parent_id(
              id,
              name
            )
          ),
          meetings (
            meeting_date
          )
        `)
        .in('eligibility_status', ['feasible_no_check', 'feasible_check', 'not_feasible']);

      // Filter by eligibility_status_last_edited_at (primary tracking column)
      // fromDate and toDate already have time components appended
      if (fromDate) {
        newLeadsQuery = newLeadsQuery.gte('eligibility_status_last_edited_at', fromDate);
      }
      if (toDate) {
        newLeadsQuery = newLeadsQuery.lte('eligibility_status_last_edited_at', toDate);
      }
      if (filters.stage) newLeadsQuery = newLeadsQuery.eq('stage', parseInt(filters.stage));
      if (filters.language) newLeadsQuery = newLeadsQuery.eq('language_id', parseInt(filters.language));
      if (filters.category) {
        // Get subcategories for the selected main category
        const { data: subCategories } = await supabase
          .from('misc_category')
          .select('id')
          .eq('parent_id', parseInt(filters.category));
        if (subCategories && subCategories.length > 0) {
          const subCategoryIds = subCategories.map(sc => sc.id.toString());
          newLeadsQuery = newLeadsQuery.in('category_id', subCategoryIds);
        } else {
          newLeadsQuery = newLeadsQuery.eq('category_id', -1);
        }
      }
      if (filters.expertExamination) {
        newLeadsQuery = newLeadsQuery.eq('eligibility_status', filters.expertExamination);
      }
      if (filters.expert) {
        newLeadsQuery = newLeadsQuery.eq('expert', parseInt(filters.expert));
      }
      if (filters.source) {
        newLeadsQuery = newLeadsQuery.eq('source', filters.source);
      }

      const { data: newLeadsData, error: newLeadsError } = await newLeadsQuery;

      if (newLeadsError) {
        console.error('Error fetching new leads:', newLeadsError);
        throw newLeadsError;
      }

      // Build query for legacy leads with expert examination results
      let legacyLeadsQuery = supabase
        .from('leads_lead')
        .select(`
          id,
          name,
          category_id,
          category,
          stage,
          language_id,
          source_id,
          expert_id,
          expert_examination,
          meeting_scheduler_id,
          meeting_manager_id,
          total_base,
          currency_id,
          meeting_date,
          misc_category!category_id(
            id,
            name,
            parent_id,
            misc_maincategory!parent_id(
              id,
              name
            )
          )
        `)
        .not('expert_examination', 'is', null)
        .neq('expert_examination', '0')
        .neq('expert_examination', '');

      if (fromDate) legacyLeadsQuery = legacyLeadsQuery.gte('eligibilty_date', fromDate);
      if (toDate) legacyLeadsQuery = legacyLeadsQuery.lte('eligibilty_date', toDate);
      if (filters.stage) legacyLeadsQuery = legacyLeadsQuery.eq('stage', parseInt(filters.stage));
      if (filters.language) legacyLeadsQuery = legacyLeadsQuery.eq('language_id', parseInt(filters.language));
      if (filters.category) {
        const { data: subCategories } = await supabase
          .from('misc_category')
          .select('id')
          .eq('parent_id', parseInt(filters.category));
        if (subCategories && subCategories.length > 0) {
          const subCategoryIds = subCategories.map(sc => sc.id);
          legacyLeadsQuery = legacyLeadsQuery.in('category_id', subCategoryIds);
        } else {
          legacyLeadsQuery = legacyLeadsQuery.eq('category_id', -1);
        }
      }
      if (filters.expertExamination) {
        const examValue = filters.expertExamination === 'feasible_no_check' ? '8' : 
                         filters.expertExamination === 'feasible_check' ? '5' : '1';
        legacyLeadsQuery = legacyLeadsQuery.eq('expert_examination', examValue);
      }
      if (filters.expert) {
        legacyLeadsQuery = legacyLeadsQuery.eq('expert_id', parseInt(filters.expert));
      }
      // Note: Legacy leads use source_id (integer FK), not source (string)
      // Source filter for legacy leads would require joining with misc_leadsource table
      // For now, we'll skip source filtering for legacy leads
      // if (filters.source) {
      //   legacyLeadsQuery = legacyLeadsQuery.eq('source_id', parseInt(filters.source));
      // }

      const { data: legacyLeadsData, error: legacyLeadsError } = await legacyLeadsQuery;

      if (legacyLeadsError) {
        console.error('Error fetching legacy leads:', legacyLeadsError);
        throw legacyLeadsError;
      }

      // Fetch stage dates for "meeting scheduled" (stage 20) from leads_leadstage
      const newLeadIds = (newLeadsData || []).map(lead => lead.id).filter(Boolean);
      const legacyLeadIds = (legacyLeadsData || []).map(lead => lead.id).filter(Boolean);

      // Fetch stage dates for new leads
      const stageDatesMap: Record<string, string> = {};
      if (newLeadIds.length > 0) {
        const { data: newLeadStageData } = await supabase
          .from('leads_leadstage')
          .select('newlead_id, date')
          .in('newlead_id', newLeadIds)
          .eq('stage', 20)
          .order('date', { ascending: true });

        if (newLeadStageData) {
          // Use the earliest date for each lead (first time stage 20 was set)
          newLeadStageData.forEach((stage: any) => {
            if (stage.newlead_id && stage.date) {
              const leadId = stage.newlead_id;
              if (!stageDatesMap[leadId] || new Date(stage.date) < new Date(stageDatesMap[leadId])) {
                stageDatesMap[leadId] = stage.date;
              }
            }
          });
        }
      }

      // Fetch stage dates for legacy leads
      if (legacyLeadIds.length > 0) {
        const { data: legacyLeadStageData } = await supabase
          .from('leads_leadstage')
          .select('lead_id, date')
          .in('lead_id', legacyLeadIds)
          .eq('stage', 20)
          .order('date', { ascending: true });

        if (legacyLeadStageData) {
          // Use the earliest date for each lead (first time stage 20 was set)
          legacyLeadStageData.forEach((stage: any) => {
            if (stage.lead_id && stage.date) {
              const leadId = `legacy_${stage.lead_id}`;
              if (!stageDatesMap[leadId] || new Date(stage.date) < new Date(stageDatesMap[leadId])) {
                stageDatesMap[leadId] = stage.date;
              }
            }
          });
        }
      }

      // Process new leads
      const processedNewLeads = (newLeadsData || []).map(lead => {
        const meetingDate = lead.meeting_date || (lead.meetings && lead.meetings.length > 0 ? lead.meetings[0].meeting_date : null);
        const amount = typeof lead.balance === 'number' ? lead.balance : (typeof lead.proposal_total === 'number' ? lead.proposal_total : 0);
        const currency = lead.balance_currency || lead.proposal_currency || 'NIS';
        const amountNIS = convertToNIS(amount, currency);

        return {
          id: lead.id,
          lead_number: lead.lead_number || lead.id,
          name: lead.name || 'Unnamed Lead',
          category: getCategoryName(lead.category_id, lead.misc_category),
          stage: lead.stage ? stages.find(s => s.id === lead.stage)?.name || String(lead.stage) : '---',
          language: lead.language || '---',
          expert_set_date: stageDatesMap[lead.id] || null,
          meeting_date: meetingDate,
          scheduler: resolveEmployeeName(lead.scheduler),
          manager: resolveEmployeeName(lead.manager),
          expert: resolveEmployeeName(lead.expert),
          total: amount,
          totalNIS: amountNIS,
          total_display: formatCurrency(amount, currency),
          result: getExpertExaminationResult({ ...lead, lead_type: 'new' }),
          lead_type: 'new' as const
        };
      });

      // Process legacy leads
      const processedLegacyLeads = (legacyLeadsData || []).map(lead => {
        const amount = typeof lead.total_base === 'number' ? lead.total_base : 0;
        const currencyId = lead.currency_id;
        const currency = currencyId ? (currencyId === 1 ? 'NIS' : currencyId === 2 ? 'EUR' : currencyId === 3 ? 'USD' : currencyId === 4 ? 'GBP' : 'NIS') : 'NIS';
        const amountNIS = convertToNIS(amount, currencyId || 'NIS');

        return {
          id: `legacy_${lead.id}`,
          lead_number: lead.id?.toString() || '',
          name: lead.name || 'Unnamed Lead',
          category: getCategoryName(lead.category_id, lead.misc_category),
          stage: lead.stage ? stages.find(s => s.id === lead.stage)?.name || String(lead.stage) : '---',
          language: lead.language_id ? languages.find(l => l.id === lead.language_id)?.name || '---' : '---',
          expert_set_date: stageDatesMap[`legacy_${lead.id}`] || null,
          meeting_date: lead.meeting_date || null,
          scheduler: resolveEmployeeName(lead.meeting_scheduler_id),
          manager: resolveEmployeeName(lead.meeting_manager_id),
          expert: resolveEmployeeName(lead.expert_id),
          total: amount,
          totalNIS: amountNIS,
          total_display: formatCurrency(amount, currency),
          result: getExpertExaminationResult({ ...lead, lead_type: 'legacy' }),
          lead_type: 'legacy' as const
        };
      });

      const allLeads = [...processedNewLeads, ...processedLegacyLeads];
      setResults(allLeads);
    } catch (error: any) {
      console.error('Error fetching experts results:', error);
      toast.error('Failed to fetch experts results data');
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  // Calculate summary statistics
  const summaryStats = useMemo(() => {
    const totalLeads = results.length;
    // Sum all amounts converted to NIS
    const totalAmount = results.reduce((sum, lead) => {
      const amountNIS = (lead as any).totalNIS || 0;
      return sum + (typeof amountNIS === 'number' ? amountNIS : 0);
    }, 0);
    return { totalLeads, totalAmount };
  }, [results]);

  // Generate color palette for experts
  const generateColors = (count: number): string[] => {
    const colors = [
      '#8884d8', '#82ca9d', '#ffc658', '#ff7300', '#00ff00',
      '#0088fe', '#00c49f', '#ffbb28', '#ff8042', '#8884d8',
      '#8dd1e1', '#d084d0', '#ffb347', '#87ceeb', '#dda0dd',
      '#98d8c8', '#f7dc6f', '#bb8fce', '#85c1e2', '#f8b88b'
    ];
    return colors.slice(0, count);
  };

  // Calculate chart data by expert
  const chartData = useMemo(() => {
    const expertCounts: Record<string, number> = {};
    results.forEach(lead => {
      if (lead.expert && lead.expert !== '---') {
        expertCounts[lead.expert] = (expertCounts[lead.expert] || 0) + 1;
      }
    });

    const data = Object.entries(expertCounts)
      .map(([name, count]) => ({ name, value: count }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10); // Top 10 experts

    // Assign colors to each expert
    const colors = generateColors(data.length);
    return data.map((item, index) => ({
      ...item,
      fill: colors[index]
    }));
  }, [results]);

  const getStageName = (stageId: string | number | null | undefined) => {
    if (!stageId) return '---';
    const found = stages.find(s => s.id.toString() === String(stageId));
    return found ? found.name : String(stageId);
  };

  return (
    <div className="px-2 py-6">
      <h2 className="text-2xl font-bold mb-6 px-4">Experts Results</h2>
      
      {/* Filters */}
      <div className="mb-6 px-4">
        <div className="space-y-4">
          {/* Input fields section */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">From date:</label>
              <input
                type="date"
                value={filters.fromDate}
                onChange={(e) => handleFilterChange('fromDate', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">To date:</label>
              <input
                type="date"
                value={filters.toDate}
                onChange={(e) => handleFilterChange('toDate', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          
          {/* Dropdowns section - all as searchable input fields */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
            <div className="relative">
              <label className="block text-sm font-medium text-gray-700 mb-1">Stage:</label>
              <input
                type="text"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Search stage..."
                value={stageSearch}
                onChange={(e) => {
                  setStageSearch(e.target.value);
                  setShowStageDropdown(true);
                  if (!e.target.value) {
                    handleFilterChange('stage', '');
                  }
                }}
                onFocus={() => setShowStageDropdown(true)}
                onBlur={() => setTimeout(() => setShowStageDropdown(false), 200)}
              />
              {showStageDropdown && filteredStages.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                  <div
                    className="px-4 py-2 cursor-pointer hover:bg-gray-100 text-sm"
                    onClick={() => {
                      handleFilterChange('stage', '');
                      setStageSearch('');
                      setShowStageDropdown(false);
                    }}
                  >
                    All Stages
                  </div>
                  {filteredStages.map((stage) => (
                    <div
                      key={stage.id}
                      className="px-4 py-2 cursor-pointer hover:bg-gray-100 text-sm"
                      onClick={() => {
                        handleFilterChange('stage', stage.id.toString());
                        setStageSearch(stage.name);
                        setShowStageDropdown(false);
                      }}
                    >
                      {stage.name}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="relative">
              <label className="block text-sm font-medium text-gray-700 mb-1">Language:</label>
              <input
                type="text"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Search language..."
                value={languageSearch}
                onChange={(e) => {
                  setLanguageSearch(e.target.value);
                  setShowLanguageDropdown(true);
                  if (!e.target.value) {
                    handleFilterChange('language', '');
                  }
                }}
                onFocus={() => setShowLanguageDropdown(true)}
                onBlur={() => setTimeout(() => setShowLanguageDropdown(false), 200)}
              />
              {showLanguageDropdown && filteredLanguages.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                  <div
                    className="px-4 py-2 cursor-pointer hover:bg-gray-100 text-sm"
                    onClick={() => {
                      handleFilterChange('language', '');
                      setLanguageSearch('');
                      setShowLanguageDropdown(false);
                    }}
                  >
                    All Languages
                  </div>
                  {filteredLanguages.map((lang) => (
                    <div
                      key={lang.id}
                      className="px-4 py-2 cursor-pointer hover:bg-gray-100 text-sm"
                      onClick={() => {
                        handleFilterChange('language', lang.id.toString());
                        setLanguageSearch(lang.name);
                        setShowLanguageDropdown(false);
                      }}
                    >
                      {lang.name}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="relative">
              <label className="block text-sm font-medium text-gray-700 mb-1">Category:</label>
              <input
                type="text"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Search category..."
                value={categorySearch}
                onChange={(e) => {
                  setCategorySearch(e.target.value);
                  setShowCategoryDropdown(true);
                  if (!e.target.value) {
                    handleFilterChange('category', '');
                  }
                }}
                onFocus={() => setShowCategoryDropdown(true)}
                onBlur={() => setTimeout(() => setShowCategoryDropdown(false), 200)}
              />
              {showCategoryDropdown && filteredCategories.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                  <div
                    className="px-4 py-2 cursor-pointer hover:bg-gray-100 text-sm"
                    onClick={() => {
                      handleFilterChange('category', '');
                      setCategorySearch('');
                      setShowCategoryDropdown(false);
                    }}
                  >
                    All Categories
                  </div>
                  {filteredCategories.map((cat) => (
                    <div
                      key={cat.id}
                      className="px-4 py-2 cursor-pointer hover:bg-gray-100 text-sm"
                      onClick={() => {
                        handleFilterChange('category', cat.id.toString());
                        setCategorySearch(cat.name);
                        setShowCategoryDropdown(false);
                      }}
                    >
                      {cat.name}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="relative">
              <label className="block text-sm font-medium text-gray-700 mb-1">Expert examination:</label>
              <input
                type="text"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Search examination..."
                value={expertExaminationSearch}
                onChange={(e) => {
                  setExpertExaminationSearch(e.target.value);
                  setShowExpertExaminationDropdown(true);
                  if (!e.target.value) {
                    handleFilterChange('expertExamination', '');
                  }
                }}
                onFocus={() => setShowExpertExaminationDropdown(true)}
                onBlur={() => setTimeout(() => setShowExpertExaminationDropdown(false), 200)}
              />
              {showExpertExaminationDropdown && filteredExpertExaminations.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                  <div
                    className="px-4 py-2 cursor-pointer hover:bg-gray-100 text-sm"
                    onClick={() => {
                      handleFilterChange('expertExamination', '');
                      setExpertExaminationSearch('');
                      setShowExpertExaminationDropdown(false);
                    }}
                  >
                    All Examinations
                  </div>
                  {filteredExpertExaminations.map((opt) => (
                    <div
                      key={opt.value}
                      className="px-4 py-2 cursor-pointer hover:bg-gray-100 text-sm"
                      onClick={() => {
                        handleFilterChange('expertExamination', opt.value);
                        setExpertExaminationSearch(opt.label);
                        setShowExpertExaminationDropdown(false);
                      }}
                    >
                      {opt.label}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="relative">
              <label className="block text-sm font-medium text-gray-700 mb-1">Expert:</label>
              <input
                type="text"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Search expert..."
                value={expertSearch}
                onChange={(e) => {
                  setExpertSearch(e.target.value);
                  setShowExpertDropdown(true);
                  if (!e.target.value) {
                    handleFilterChange('expert', '');
                  }
                }}
                onFocus={() => setShowExpertDropdown(true)}
                onBlur={() => setTimeout(() => setShowExpertDropdown(false), 200)}
              />
              {showExpertDropdown && filteredExperts.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                  <div
                    className="px-4 py-2 cursor-pointer hover:bg-gray-100 text-sm"
                    onClick={() => {
                      handleFilterChange('expert', '');
                      setExpertSearch('');
                      setShowExpertDropdown(false);
                    }}
                  >
                    All Experts
                  </div>
                  {filteredExperts.map((emp) => (
                    <div
                      key={emp.id}
                      className="px-4 py-2 cursor-pointer hover:bg-gray-100 text-sm"
                      onClick={() => {
                        handleFilterChange('expert', emp.id.toString());
                        setExpertSearch(emp.name);
                        setShowExpertDropdown(false);
                      }}
                    >
                      {emp.name}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="relative">
              <label className="block text-sm font-medium text-gray-700 mb-1">Source:</label>
              <input
                type="text"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Search source..."
                value={sourceSearch}
                onChange={(e) => {
                  setSourceSearch(e.target.value);
                  setShowSourceDropdown(true);
                  if (!e.target.value) {
                    handleFilterChange('source', '');
                  }
                }}
                onFocus={() => setShowSourceDropdown(true)}
                onBlur={() => setTimeout(() => setShowSourceDropdown(false), 200)}
              />
              {showSourceDropdown && filteredSources.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                  <div
                    className="px-4 py-2 cursor-pointer hover:bg-gray-100 text-sm"
                    onClick={() => {
                      handleFilterChange('source', '');
                      setSourceSearch('');
                      setShowSourceDropdown(false);
                    }}
                  >
                    All Sources
                  </div>
                  {filteredSources.map((source) => (
                    <div
                      key={source}
                      className="px-4 py-2 cursor-pointer hover:bg-gray-100 text-sm"
                      onClick={() => {
                        handleFilterChange('source', source);
                        setSourceSearch(source);
                        setShowSourceDropdown(false);
                      }}
                    >
                      {source}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="mt-4">
          <button
            onClick={handleSearch}
            disabled={isSearching}
            className="btn btn-primary"
          >
            {isSearching ? 'Loading...' : 'Show'}
          </button>
        </div>
      </div>

      {/* Summary Bar */}
      {searchPerformed && (
        <div className="mb-6 px-4">
          <div className="bg-gray-200 px-4 py-2 rounded-md">
            <span className="font-semibold">
              {summaryStats.totalLeads} Leads Total: {formatCurrency(summaryStats.totalAmount, 'NIS')}
            </span>
          </div>
        </div>
      )}

      {/* Bar Chart */}
      {searchPerformed && chartData.length > 0 && (
        <div className="mb-6 px-4">
          <div className="bg-white p-4 rounded-lg shadow">
            <h3 className="text-lg font-semibold mb-4">Expert Results</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis domain={[0, 'dataMax + 0.5']} />
                <Tooltip />
                <Legend />
                <Bar dataKey="value">
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.fill || '#8884d8'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Results Table */}
      {searchPerformed && (
        <div className="px-4">
          {results.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              No results found.
            </div>
          ) : (
            <div className="overflow-x-auto -mx-2">
              <div className="px-4">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Lead</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Category</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Stage</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Lang</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Expert set Date</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Meeting Date</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Scheduler</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Manager</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Expert</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Total</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Result (Feasibility)</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {results.map((lead, index) => (
                      <tr key={lead.id || index} className="hover:bg-gray-50">
                        <td className="px-4 py-4 whitespace-nowrap">
                          <Link
                            to={`/clients/${lead.lead_number}`}
                            className="text-blue-600 hover:text-blue-800 font-semibold"
                          >
                            #{lead.lead_number} {lead.name}
                          </Link>
                        </td>
                        <td className="px-4 py-4 text-sm text-gray-900">{lead.category}</td>
                        <td className="px-4 py-4 text-sm text-gray-900">{lead.stage}</td>
                        <td className="px-4 py-4 text-sm text-gray-900">{lead.language}</td>
                        <td className="px-4 py-4 text-sm text-gray-900">{formatDate(lead.expert_set_date)}</td>
                        <td className="px-4 py-4 text-sm text-gray-900">{formatDate(lead.meeting_date)}</td>
                        <td className="px-4 py-4 text-sm text-gray-900">{lead.scheduler}</td>
                        <td className="px-4 py-4 text-sm text-gray-900">{lead.manager}</td>
                        <td className="px-4 py-4 text-sm">
                          <span className="px-2 py-1 rounded-full bg-blue-100 text-blue-800 text-xs font-semibold">
                            {lead.expert}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-sm text-gray-900">{lead.total_display}</td>
                        <td className="px-4 py-4 text-sm">
                          <span className={`px-2 py-1 rounded-full text-xs font-semibold ${lead.result.color}`}>
                            {lead.result.text}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
const EmployeesPerformanceReport = () => <div className="p-6">Employees Performance Analysis Content</div>;
const StatisticsReport = () => <div className="p-6">Statistics Analysis Content</div>;
const PiesReport = () => <div className="p-6">Pies Analysis Content</div>;
const TasksReport = () => <div className="p-6">Tasks Analysis Content</div>;
const ProfitabilityReport = () => <div className="p-6">Profitability Finances Content</div>;
const CollectionDueReport = () => {
  const navigate = useNavigate();
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  const [filters, setFilters] = usePersistedFilters('reports_collectionDue_filters', {
    fromDate: todayStr,
    toDate: todayStr,
    category: '',
    order: '',
    department: '',
    employee: '',
    employeeType: 'case_handler', // 'case_handler' or 'actual_employee_due'
  }, {
    storage: 'sessionStorage',
  });
  const [employeeData, setEmployeeData] = usePersistedFilters<any[]>('reports_collectionDue_employeeData', [], {
    storage: 'sessionStorage',
  });
  const [departmentData, setDepartmentData] = usePersistedFilters<any[]>('reports_collectionDue_departmentData', [], {
    storage: 'sessionStorage',
  });
  const [totalDue, setTotalDue] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [searchPerformed, setSearchPerformed] = usePersistedFilters('reports_collectionDue_performed', false, {
    storage: 'sessionStorage',
  });
  const [employees, setEmployees] = useState<{ id: number; name: string }[]>([]);
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [allCategories, setAllCategories] = useState<any[]>([]);
  const [categoryNameToDataMap, setCategoryNameToDataMap] = useState<Map<string, any>>(new Map());
  
  // Drawer state for lead details
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [drawerTitle, setDrawerTitle] = useState('');
  const [drawerLeads, setDrawerLeads] = useState<any[]>([]);
  const [drawerLoading, setDrawerLoading] = useState(false);
  
  // Store maps for accessing leadIds when drawer opens
  const [employeeMapStore, setEmployeeMapStore] = useState<Map<string, { handlerId: number | null; handlerName: string; departmentName: string; cases: Set<string>; applicantsLeads: Set<string>; applicants: number; total: number }>>(new Map());
  const [departmentMapStore, setDepartmentMapStore] = useState<Map<string, { departmentName: string; cases: Set<string>; applicantsLeads: Set<string>; applicants: number; total: number }>>(new Map());
  // Store payment values per lead for drawer display
  const [paymentValueMap, setPaymentValueMap] = useState<Map<string, { value: number; currency: string }>>(new Map());

  useEffect(() => {
    const fetchOptions = async () => {
      // Fetch employees
      const { data: empData } = await supabase
        .from('tenants_employee')
        .select('id, display_name')
        .order('display_name');
      if (empData) {
        setEmployees(empData.map(emp => ({ id: emp.id, name: emp.display_name || `Employee #${emp.id}` })));
      }

      // Fetch departments from tenant_departement (like Dashboard does)
      const { data: deptData } = await supabase
        .from('tenant_departement')
        .select('id, name')
        .order('name');
      if (deptData) {
        setDepartments(deptData.map(dept => ({ id: dept.id.toString(), name: dept.name })));
      }

      // Fetch categories
      const { data: catData } = await supabase
        .from('misc_maincategory')
        .select('id, name')
        .order('name');
      if (catData) {
        setCategories(catData.map(cat => ({ id: cat.id.toString(), name: cat.name })));
      }

      // Fetch all categories with their parent main category names and departments using JOINs
      const { data: categoriesData, error: categoriesError } = await supabase
        .from('misc_category')
        .select(`
          id,
          name,
          parent_id,
          misc_maincategory!parent_id (
            id,
            name,
            department_id,
            tenant_departement!department_id (
              id,
              name
            )
          )
        `)
        .order('name', { ascending: true });
      
      if (!categoriesError && categoriesData) {
        setAllCategories(categoriesData);
        
        // Create a map from category name (normalized) to category data (including main category and department)
        const nameToDataMap = new Map<string, any>();
        categoriesData.forEach((category: any) => {
          if (category.name) {
            const normalizedName = category.name.trim().toLowerCase();
            nameToDataMap.set(normalizedName, category);
          }
        });
        setCategoryNameToDataMap(nameToDataMap);
      }
    };
    fetchOptions();
  }, []);

  const handleFilterChange = (field: string, value: any) => {
    setFilters(prev => ({ ...prev, [field]: value }));
  };

  // Helper function to normalize order code (similar to CollectionFinancesReport)
  const normalizeOrderCode = (order: string | number | null | undefined): string => {
    if (order === null || order === undefined) return '';
    const raw = order.toString().trim();
    if (!raw) return '';
    if (!Number.isNaN(Number(raw))) {
      return raw;
    }
    switch (raw.toLowerCase()) {
      case 'first payment':
        return '1';
      case 'intermediate payment':
        return '5';
      case 'final payment':
        return '9';
      case 'single payment':
        return '90';
      case 'expense (no vat)':
        return '99';
      default:
        return raw;
    }
  };

  // Helper function to resolve category and get department (similar to SignedSalesReportPage)
  const resolveCategoryAndDepartment = (
    categoryValue?: string | null,
    categoryId?: string | number | null,
    miscCategory?: any
  ): { departmentId: string | null; departmentName: string } => {
    // If we have categoryValue but no miscCategory, try to look it up in the map
    let resolvedMiscCategory = miscCategory;
    if (!miscCategory && categoryValue && categoryValue.trim() !== '' && categoryNameToDataMap.size > 0) {
      const normalizedName = categoryValue.trim().toLowerCase();
      const mappedCategory = categoryNameToDataMap.get(normalizedName);
      if (mappedCategory) {
        resolvedMiscCategory = mappedCategory;
      }
    }
    
    // If we still don't have a category, return defaults
    if (!resolvedMiscCategory) {
      return { departmentId: null, departmentName: '—' };
    }

    // Handle array case (shouldn't happen, but be safe)
    const categoryRecord = Array.isArray(resolvedMiscCategory) ? resolvedMiscCategory[0] : resolvedMiscCategory;
    if (!categoryRecord) {
      return { departmentId: null, departmentName: '—' };
    }

    // Extract main category (handle both array and object cases)
    let mainCategory = Array.isArray(categoryRecord.misc_maincategory)
      ? categoryRecord.misc_maincategory[0]
      : categoryRecord.misc_maincategory;

    if (!mainCategory) {
      return { departmentId: null, departmentName: categoryRecord.name || '—' };
    }

    // Extract department from main category
    const department = mainCategory.tenant_departement 
      ? (Array.isArray(mainCategory.tenant_departement) ? mainCategory.tenant_departement[0] : mainCategory.tenant_departement)
      : null;

    const departmentId = department?.id?.toString() || null;
    const departmentName = department?.name || mainCategory.name || categoryRecord.name || '—';

    return { departmentId, departmentName };
  };

  // Helper function to get category name from ID with main category (similar to CalendarPage)
  const getCategoryName = (categoryId: string | number | null | undefined, fallbackCategory?: string | number) => {
    if (!categoryId || categoryId === '---' || categoryId === '--') {
      // If no category_id but we have a fallback category, try to find it in the loaded categories
      if (fallbackCategory && String(fallbackCategory).trim() !== '') {
        // Try to find the fallback category in the loaded categories
        // First try by ID if fallbackCategory is a number
        let foundCategory = null;
        if (typeof fallbackCategory === 'number') {
          foundCategory = allCategories.find((cat: any) => 
            cat.id.toString() === fallbackCategory.toString()
          );
        }
        
        // If not found by ID, try by name
        if (!foundCategory) {
          foundCategory = allCategories.find((cat: any) => 
            cat.name.toLowerCase().trim() === String(fallbackCategory).toLowerCase().trim()
          );
        }
        
        if (foundCategory) {
          // Return category name with main category in parentheses
          if (foundCategory.misc_maincategory?.name) {
            return `${foundCategory.name} (${foundCategory.misc_maincategory.name})`;
          } else {
            return foundCategory.name; // Fallback if no main category
          }
        } else {
          return String(fallbackCategory); // Use as-is if not found in loaded categories
        }
      }
      return '--';
    }
    
    // If allCategories is not loaded yet, return the original value
    if (!allCategories || allCategories.length === 0) {
      return String(categoryId);
    }
    
    // First try to find by ID
    const categoryById = allCategories.find((cat: any) => cat.id.toString() === categoryId.toString());
    if (categoryById) {
      // Return category name with main category in parentheses
      if (categoryById.misc_maincategory?.name) {
        return `${categoryById.name} (${categoryById.misc_maincategory.name})`;
      } else {
        return categoryById.name; // Fallback if no main category
      }
    }
    
    // If not found by ID, try to find by name (in case it's already a name)
    const categoryByName = allCategories.find((cat: any) => cat.name === categoryId);
    if (categoryByName) {
      // Return category name with main category in parentheses
      if (categoryByName.misc_maincategory?.name) {
        return `${categoryByName.name} (${categoryByName.misc_maincategory.name})`;
      } else {
        return categoryByName.name; // Fallback if no main category
      }
    }
    
    return String(categoryId); // Fallback to original value if not found
  };

  // Export functions for Excel
  const exportEmployeeTable = () => {
    if (employeeData.length === 0) {
      toast.error('No data to export');
      return;
    }

    const headers = ['Employee', 'Department', 'Cases', 'Applicants', 'Total'];
    const excelData = employeeData.map(row => ({
      'Employee': row.employee,
      'Department': row.department,
      'Cases': row.cases,
      'Applicants': row.applicants,
      'Total': formatCurrency(row.total)
    }));

    const ws = XLSX.utils.json_to_sheet(excelData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'By Employee');
    
    const dateStr = new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, `Collection_Due_By_Employee_${dateStr}.xlsx`);
  };

  const exportDepartmentTable = () => {
    if (departmentData.length === 0) {
      toast.error('No data to export');
      return;
    }

    const headers = ['Department', 'Cases', 'Applicants', 'Total'];
    const excelData = departmentData.map(row => ({
      'Department': row.department,
      'Cases': row.cases,
      'Applicants': row.applicants,
      'Total': formatCurrency(row.total)
    }));

    const ws = XLSX.utils.json_to_sheet(excelData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'By Department');
    
    const dateStr = new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, `Collection_Due_By_Department_${dateStr}.xlsx`);
  };

  const handleSearch = async () => {
    setLoading(true);
    setSearchPerformed(true);
    try {
      console.log('🔍 Collection Due Report - Starting search with filters:', filters);
      
      // First, let's check what exists in the database without filters to debug
      console.log('🔍 Collection Due Report - DEBUG: Checking all payment_plans in date range...');
      const debugNewFromDate = filters.fromDate ? `${filters.fromDate}T00:00:00` : '2020-01-01T00:00:00';
      const debugNewToDate = filters.toDate ? `${filters.toDate}T23:59:59` : '2030-12-31T23:59:59';
      const { data: debugNewPayments, error: debugNewError } = await supabase
        .from('payment_plans')
        .select('id, lead_id, due_date, ready_to_pay, cancel_date, paid')
        .gte('due_date', debugNewFromDate)
        .lte('due_date', debugNewToDate)
        .limit(10);
      
      if (debugNewError) {
        console.error('❌ Collection Due Report - DEBUG Error:', debugNewError);
      } else {
        console.log('📊 Collection Due Report - DEBUG: Sample new payments (first 10):', debugNewPayments);
        console.log('📊 Collection Due Report - DEBUG: ready_to_pay values:', debugNewPayments?.map(p => ({ id: p.id, ready_to_pay: p.ready_to_pay, due_date: p.due_date })));
      }
      
      // Fetch new payment plans - only unpaid ones that are ready to pay
      console.log('🔍 Collection Due Report - Fetching new payment plans...');
      let newPaymentsQuery = supabase
        .from('payment_plans')
        .select(`
          id,
          lead_id,
          value,
          value_vat,
          currency,
          due_date,
          cancel_date,
          ready_to_pay,
          ready_to_pay_by,
          paid,
          payment_order
        `)
        .eq('ready_to_pay', true)
        .eq('paid', false) // Only unpaid payments
        .not('due_date', 'is', null)
        .is('cancel_date', null);

      if (filters.fromDate) {
        const fromDateTime = `${filters.fromDate}T00:00:00`;
        console.log('🔍 Collection Due Report - Filtering new payments from date:', fromDateTime);
        newPaymentsQuery = newPaymentsQuery.gte('due_date', fromDateTime);
      }
      if (filters.toDate) {
        const toDateTime = `${filters.toDate}T23:59:59`;
        console.log('🔍 Collection Due Report - Filtering new payments to date:', toDateTime);
        newPaymentsQuery = newPaymentsQuery.lte('due_date', toDateTime);
      }

      const { data: newPayments, error: newError } = await newPaymentsQuery;
      if (newError) {
        console.error('❌ Collection Due Report - Error fetching new payments:', newError);
        throw newError;
      }
      console.log('✅ Collection Due Report - Fetched new payments:', newPayments?.length || 0);
      
      // DEBUG: Check without ready_to_pay filter
      console.log('🔍 Collection Due Report - DEBUG: Checking new payments WITHOUT ready_to_pay filter...');
      const debugFromDate = filters.fromDate ? `${filters.fromDate}T00:00:00` : '2020-01-01T00:00:00';
      const debugToDate = filters.toDate ? `${filters.toDate}T23:59:59` : '2030-12-31T23:59:59';
      const { data: debugNewWithoutFilter, error: debugNewWithoutError } = await supabase
        .from('payment_plans')
        .select('id, lead_id, due_date, ready_to_pay, cancel_date, paid')
        .not('due_date', 'is', null)
        .is('cancel_date', null)
        .gte('due_date', debugFromDate)
        .lte('due_date', debugToDate)
        .limit(10);
      
      if (!debugNewWithoutError) {
        console.log('📊 Collection Due Report - DEBUG: New payments without ready_to_pay filter:', debugNewWithoutFilter?.length || 0);
        console.log('📊 Collection Due Report - DEBUG: Sample:', debugNewWithoutFilter);
      }

      // DEBUG: Check legacy payments
      console.log('🔍 Collection Due Report - DEBUG: Checking all finances_paymentplanrow in date range...');
      const debugLegacyFromDate = filters.fromDate ? `${filters.fromDate}T00:00:00` : '2020-01-01T00:00:00';
      const debugLegacyToDate = filters.toDate ? `${filters.toDate}T23:59:59` : '2030-12-31T23:59:59';
      const { data: debugLegacyPayments, error: debugLegacyError } = await supabase
        .from('finances_paymentplanrow')
        .select('id, lead_id, due_date, date, ready_to_pay, cancel_date, actual_date')
        .gte('date', debugLegacyFromDate)
        .lte('date', debugLegacyToDate)
        .limit(10);
      
      if (debugLegacyError) {
        console.error('❌ Collection Due Report - DEBUG Error:', debugLegacyError);
      } else {
        console.log('📊 Collection Due Report - DEBUG: Sample legacy payments (first 10):', debugLegacyPayments);
        console.log('📊 Collection Due Report - DEBUG: ready_to_pay values:', debugLegacyPayments?.map(p => ({ 
          id: p.id, 
          lead_id: p.lead_id,
          ready_to_pay: p.ready_to_pay, 
          ready_to_pay_type: typeof p.ready_to_pay,
          date: p.date, 
          due_date: p.due_date,
          actual_date: p.actual_date,
          cancel_date: p.cancel_date
        })));
        
        // Check how many have ready_to_pay = true
        const withReadyToPay = debugLegacyPayments?.filter(p => p.ready_to_pay === true || p.ready_to_pay === 'true' || p.ready_to_pay === 1);
        console.log('📊 Collection Due Report - DEBUG: Legacy payments with ready_to_pay=true:', withReadyToPay?.length || 0);
      }
      
      // Fetch legacy payment plans from finances_paymentplanrow
      // For legacy leads: if due_date exists, it means ready to pay (no need to check ready_to_pay flag)
      console.log('🔍 Collection Due Report - Fetching legacy payment plans from finances_paymentplanrow...');
      let legacyPaymentsQuery = supabase
        .from('finances_paymentplanrow')
        .select(`
          id,
          lead_id,
          value,
          value_base,
          vat_value,
          currency_id,
          due_date,
          date,
          cancel_date,
          ready_to_pay,
          actual_date,
          due_by_id,
          order,
          accounting_currencies!finances_paymentplanrow_currency_id_fkey(name, iso_code)
        `)
        .not('due_date', 'is', null) // Only fetch if due_date has a date (not NULL) - for legacy leads, due_date means ready to pay
        .is('cancel_date', null) // Exclude cancelled payments
        .is('actual_date', null); // Only unpaid payments (actual_date IS NULL means not paid yet)
      
      // Debug: Check for payments with due_by_id = 14 before filtering
      console.log('🔍 DEBUG Employee 14 - About to apply date filters to legacy payments query');

      // DEBUG: Check ALL payments for lead 183061 BEFORE applying date filters
      console.log('🔍 DEBUG Lead 183061 - Checking payments BEFORE date filters...');
      const { data: beforeFilterCheck, error: beforeFilterError } = await supabase
        .from('finances_paymentplanrow')
        .select('id, lead_id, date, due_date, cancel_date, value, value_base')
        .eq('lead_id', 183061)
        .is('cancel_date', null)
        .not('due_date', 'is', null)
        .limit(20);
      if (!beforeFilterError && beforeFilterCheck) {
        console.log('🔍 DEBUG Lead 183061 - Payments BEFORE date filters:', beforeFilterCheck.length, beforeFilterCheck.map((p: any) => ({
          id: p.id,
          date: p.date,
          due_date: p.due_date,
          value: p.value,
          value_base: p.value_base,
          cancel_date: p.cancel_date
        })));
      }

      // Filter by 'due_date' column for date range (this is what determines when payment is due)
      // For legacy leads, only fetch payment rows if due_date is available (due_date means ready to pay)
      // We already have .not('due_date', 'is', null) in the query, so we only get payments with due_date
      if (filters.fromDate) {
        const fromDateTime = `${filters.fromDate}T00:00:00`;
        console.log('🔍 Collection Due Report - Filtering legacy payments by due_date from:', fromDateTime);
        legacyPaymentsQuery = legacyPaymentsQuery.gte('due_date', fromDateTime);
      }
      if (filters.toDate) {
        const toDateTime = `${filters.toDate}T23:59:59`;
        console.log('🔍 Collection Due Report - Filtering legacy payments by due_date to:', toDateTime);
        legacyPaymentsQuery = legacyPaymentsQuery.lte('due_date', toDateTime);
      }

      const { data: legacyPayments, error: legacyError } = await legacyPaymentsQuery;
      if (legacyError) {
        console.error('❌ Collection Due Report - Error fetching legacy payments:', legacyError);
        throw legacyError;
      }
      console.log('✅ Collection Due Report - Fetched legacy payments (due_date in range, ready_to_pay):', legacyPayments?.length || 0);
      
      // DEBUG: Check specifically for lead 183061
      const paymentsFor183061 = legacyPayments?.filter((p: any) => 
        p.lead_id?.toString() === '183061' || p.lead_id === 183061
      ) || [];
      console.log('🔍 DEBUG Lead 183061 - Payments found in query result (after due_date filter):', paymentsFor183061.length);
      if (paymentsFor183061.length > 0) {
        console.log('🔍 DEBUG Lead 183061 - Payment details:', paymentsFor183061.map((p: any) => ({
          id: p.id,
          lead_id: p.lead_id,
          date: p.date,
          due_date: p.due_date,
          value: p.value,
          value_base: p.value_base,
          cancel_date: p.cancel_date,
          ready_to_pay: p.ready_to_pay,
          actual_date: p.actual_date
        })));
      } else {
        console.warn('⚠️ DEBUG Lead 183061 - NO payments found in query result! Checking if lead exists in database...');
        // Query directly to see if payments exist and what their due_date values are
        const { data: directCheck, error: directError } = await supabase
          .from('finances_paymentplanrow')
          .select('id, lead_id, date, due_date, cancel_date, value, value_base, ready_to_pay, actual_date')
          .eq('lead_id', 183061)
          .is('cancel_date', null)
          .not('due_date', 'is', null)
          .limit(10);
        if (directError) {
          console.error('❌ DEBUG Lead 183061 - Error checking directly:', directError);
        } else {
          console.log('🔍 DEBUG Lead 183061 - Direct query result (all payments for this lead):', directCheck?.length || 0);
          if (directCheck && directCheck.length > 0) {
            console.log('🔍 DEBUG Lead 183061 - Payment details with due_date:', directCheck.map((p: any) => ({
              id: p.id,
              date: p.date,
              due_date: p.due_date,
              due_date_in_range: p.due_date && p.due_date >= `${filters.fromDate}T00:00:00` && p.due_date <= `${filters.toDate}T23:59:59`,
              value: p.value,
              value_base: p.value_base,
              cancel_date: p.cancel_date,
              actual_date: p.actual_date
            })));
          }
        }
      }
      
      // No need to filter again - we already filtered by due_date in the query
      const filteredLegacyPayments = legacyPayments || [];
      
      console.log('✅ Collection Due Report - Filtered legacy payments:', filteredLegacyPayments.length);
      if (filteredLegacyPayments.length > 0) {
        console.log('📊 Collection Due Report - Sample filtered legacy payments:', filteredLegacyPayments.slice(0, 3).map((p: any) => ({
          id: p.id,
          lead_id: p.lead_id,
          due_date: p.due_date,
          date: p.date,
          value: p.value,
          ready_to_pay: p.ready_to_pay
        })));
      }
      if (filteredLegacyPayments.length > 0) {
        console.log('📊 Collection Due Report - Sample filtered legacy payments:', filteredLegacyPayments.slice(0, 3).map(p => ({
          id: p.id,
          lead_id: p.lead_id,
          due_date: p.due_date,
          date: p.date,
          value: p.value
        })));
      }

      // Get unique lead IDs
      const newLeadIds = Array.from(new Set((newPayments || []).map(p => p.lead_id).filter(Boolean)));
      const legacyLeadIds = Array.from(new Set(filteredLegacyPayments.map(p => p.lead_id).filter(Boolean))).map(id => Number(id)).filter(id => !Number.isNaN(id));
      
      console.log('🔍 Collection Due Report - Unique new lead IDs:', newLeadIds.length);
      console.log('🔍 Collection Due Report - Unique legacy lead IDs:', legacyLeadIds.length);
      console.log('🔍 DEBUG Employee 14 - Legacy lead IDs:', legacyLeadIds);
      console.log('🔍 DEBUG Employee 14 - Is 163739 in legacyLeadIds?', legacyLeadIds.includes(163739));

      // Fetch lead metadata
      let newLeadsMap = new Map();
      if (newLeadIds.length > 0) {
        console.log('🔍 Collection Due Report - Fetching new leads metadata...');
        const { data: newLeads, error: newLeadsError } = await supabase
          .from('leads')
          .select(`
            id,
            handler,
            case_handler_id,
            category_id,
            category,
            misc_category!category_id(
              id,
              name,
              parent_id,
              misc_maincategory!parent_id(
                id,
                name,
                department_id,
                tenant_departement!department_id(
                  id,
                  name
                )
              )
            )
          `)
          .in('id', newLeadIds);

        if (newLeadsError) {
          console.error('❌ Collection Due Report - Error fetching new leads:', newLeadsError);
        } else {
          console.log('✅ Collection Due Report - Fetched new leads:', newLeads?.length || 0);
          if (newLeads) {
            newLeads.forEach(lead => {
              newLeadsMap.set(lead.id, lead);
            });
          }
        }
      }

      let legacyLeadsMap = new Map();
      if (legacyLeadIds.length > 0) {
        console.log('🔍 Collection Due Report - Fetching legacy leads metadata...');
        const { data: legacyLeads, error: legacyLeadsError } = await supabase
          .from('leads_lead')
          .select(`
            id,
            case_handler_id,
            category_id,
            category,
            misc_category!category_id(
              id,
              name,
              parent_id,
              misc_maincategory!parent_id(
                id,
                name,
                department_id,
                tenant_departement!department_id(
                  id,
                  name
                )
              )
            )
          `)
          .in('id', legacyLeadIds);

        if (legacyLeadsError) {
          console.error('❌ Collection Due Report - Error fetching legacy leads:', legacyLeadsError);
        } else {
          console.log('✅ Collection Due Report - Fetched legacy leads:', legacyLeads?.length || 0);
          console.log('🔍 DEBUG Employee 14 - Fetched legacy leads:', legacyLeads?.length || 0);
          console.log('🔍 DEBUG Employee 14 - Legacy leads with case_handler_id 14:', legacyLeads?.filter((l: any) => Number(l.case_handler_id) === 14).map((l: any) => ({ id: l.id, case_handler_id: l.case_handler_id })));
          if (legacyLeads) {
            legacyLeads.forEach(lead => {
              // Store with string key to match payment.lead_id (which might be string or number)
              const key = lead.id?.toString() || String(lead.id);
              legacyLeadsMap.set(key, lead);
              // Also store with number key for compatibility
              if (typeof lead.id === 'number') {
                legacyLeadsMap.set(lead.id, lead);
              }
            });
            console.log('📊 Collection Due Report - Legacy leads map keys:', Array.from(legacyLeadsMap.keys()));
            console.log('🔍 DEBUG Employee 14 - Is lead 163739 in legacyLeadsMap?', legacyLeadsMap.has('163739') || legacyLeadsMap.has(163739));
          }
        }
      }

      // Fetch applicants count for new leads
      console.log('🔍 Collection Due Report - Fetching applicants for new leads...');
      const applicantsCountMap = new Map<string, number>();
      if (newLeadIds.length > 0) {
        const { data: contacts, error: contactsError } = await supabase
          .from('contacts')
          .select('lead_id')
          .in('lead_id', newLeadIds)
          .eq('is_persecuted', false);

        if (contactsError) {
          console.error('❌ Collection Due Report - Error fetching contacts:', contactsError);
        } else {
          console.log('✅ Collection Due Report - Fetched contacts:', contacts?.length || 0);
          if (contacts) {
            contacts.forEach(contact => {
              const count = applicantsCountMap.get(contact.lead_id) || 0;
              applicantsCountMap.set(contact.lead_id, count + 1);
            });
          }
        }
      }

      // Fetch applicants count for legacy leads
      console.log('🔍 Collection Due Report - Fetching applicants for legacy leads...');
      const legacyApplicantsCountMap = new Map<string, number>();
      if (legacyLeadIds.length > 0) {
        const { data: legacyLeadsForApplicants, error: legacyApplicantsError } = await supabase
          .from('leads_lead')
          .select('id, no_of_applicants')
          .in('id', legacyLeadIds);

        if (legacyApplicantsError) {
          console.error('❌ Collection Due Report - Error fetching legacy applicants:', legacyApplicantsError);
        } else {
          console.log('✅ Collection Due Report - Fetched legacy leads for applicants:', legacyLeadsForApplicants?.length || 0);
          if (legacyLeadsForApplicants) {
            legacyLeadsForApplicants.forEach(lead => {
              // Handle bigint null values - convert to number, default to 0 if null
              const applicantsCount = lead.no_of_applicants !== null && lead.no_of_applicants !== undefined
                ? Number(lead.no_of_applicants)
                : 0;
              legacyApplicantsCountMap.set(lead.id.toString(), applicantsCount);
            });
          }
        }
      }

      // Fetch handler names for all handler IDs (like CollectionFinancesReport does)
      const normalizeHandlerId = (value: any): number | null => {
        if (value === null || value === undefined) return null;
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : null;
      };

      // Collect handler names from new leads and handler IDs from legacy leads
      const allHandlerNames = new Set<string>(); // For new leads - handler is text field
      const allHandlerIds: number[] = []; // For legacy leads - case_handler_id or due_by_id is numeric
      
      if (filters.employeeType === 'actual_employee_due') {
        // Collect handler names/IDs from leads (actual employee due mode)
        // Collect handler names from new leads
        if (newLeadsMap.size > 0) {
          console.log('🔍 Collection Due Report - Collecting handler names from new leads (actual employee due)...');
          newLeadsMap.forEach((lead, leadId) => {
            console.log('📊 New lead handler info:', {
              leadId,
              handler: lead.handler,
              case_handler_id: lead.case_handler_id
            });
            // For new leads, use the handler text field (display_name)
            if (lead.handler && typeof lead.handler === 'string' && lead.handler.trim() && lead.handler !== '---' && lead.handler.toLowerCase() !== 'not assigned') {
              allHandlerNames.add(lead.handler.trim());
              console.log('✅ Added handler name:', lead.handler.trim());
            } else if (lead.case_handler_id) {
              // Fallback to case_handler_id if handler text is not available
              const handlerId = normalizeHandlerId(lead.case_handler_id);
              if (handlerId !== null) {
                allHandlerIds.push(handlerId);
                console.log('✅ Added case_handler_id:', handlerId);
              }
            }
          });
        }
        
        // Collect case_handler_id from legacy leads
        if (legacyLeadsMap.size > 0) {
          console.log('🔍 Collection Due Report - Collecting handler IDs from legacy leads (actual employee due)...');
          legacyLeadsMap.forEach((lead: any, leadId: any) => {
            console.log('📊 Legacy lead handler info:', {
              leadId,
              case_handler_id: lead?.case_handler_id,
              case_handler_id_type: typeof lead.case_handler_id
            });
            const handlerId = normalizeHandlerId(lead.case_handler_id);
            if (handlerId !== null) {
              allHandlerIds.push(handlerId);
              if (handlerId === 14) {
                console.log('✅ DEBUG Employee 14 - Added handler ID 14 from legacy lead:', leadId);
              }
              console.log('✅ Added handler ID:', handlerId);
            } else {
              console.log('⚠️ Handler ID is null for lead:', leadId);
            }
          });
        }
      } else {
        // Default (case_handler): Collect ready_to_pay_by from new payments and due_by_id from legacy payments
        // Collect ready_to_pay_by from new payments
        console.log('🔍 Collection Due Report - Collecting ready_to_pay_by from new payments (default)...');
        (newPayments || []).forEach((payment: any) => {
          const handlerId = normalizeHandlerId(payment.ready_to_pay_by);
          if (handlerId !== null) {
            allHandlerIds.push(handlerId);
            console.log('✅ Added ready_to_pay_by:', handlerId);
          }
        });
        
        // Collect due_by_id from legacy payments
        console.log('🔍 Collection Due Report - Collecting due_by_id from legacy payments (default)...');
        filteredLegacyPayments.forEach((payment: any) => {
          const handlerId = normalizeHandlerId(payment.due_by_id);
          if (handlerId !== null) {
            allHandlerIds.push(handlerId);
            if (handlerId === 14) {
              console.log('✅ DEBUG Employee 14 - Added handler ID 14 from legacy payment due_by_id:', {
                paymentId: payment.id,
                leadId: payment.lead_id,
                due_by_id: payment.due_by_id
              });
            }
            console.log('✅ Added due_by_id:', handlerId);
          }
        });
      }
      console.log('📊 Collection Due Report - All collected handler names (new):', Array.from(allHandlerNames));
      console.log('📊 Collection Due Report - All collected handler IDs (legacy):', allHandlerIds);
      console.log('🔍 DEBUG Employee 14 - Employee 14 in allHandlerIds?', allHandlerIds.includes(14));

      // Fetch handler information:
      // 1. For new leads (case_handler mode): fetch employees by display_name (handler text field) to get their IDs
      // 2. For new leads (actual_employee_due mode): ready_to_pay_by IDs are collected into allHandlerIds
      // 3. For legacy leads: fetch employees by ID (case_handler_id or due_by_id) to get their display_name
      const handlerMap = new Map<number, string>(); // ID -> display_name
      const handlerNameToIdMap = new Map<string, number>(); // display_name -> ID (for new leads in case_handler mode)
      
      console.log('🔍 DEBUG Employee 14 - All collected handler names (new):', Array.from(allHandlerNames));
      console.log('🔍 DEBUG Employee 14 - All collected handler IDs (legacy):', allHandlerIds);
      console.log('🔍 DEBUG Employee 14 - Employee 14 in handler IDs?', allHandlerIds.includes(14));
      
      // Fetch employees by display_name for new leads
      if (allHandlerNames.size > 0) {
        const handlerNamesArray = Array.from(allHandlerNames);
        console.log('🔍 Collection Due Report - Fetching employees by display_name for new leads:', handlerNamesArray);
        const { data: handlerDataByName, error: handlerErrorByName } = await supabase
          .from('tenants_employee')
          .select('id, display_name')
          .in('display_name', handlerNamesArray);
        
        if (handlerErrorByName) {
          console.error('❌ Collection Due Report - Error fetching handlers by name:', handlerErrorByName);
        } else {
          console.log('📊 Collection Due Report - Handler data by name received:', handlerDataByName?.map(emp => ({ id: emp.id, display_name: emp.display_name })));
          handlerDataByName?.forEach(emp => {
            const empId = Number(emp.id);
            const displayName = emp.display_name?.trim();
            if (!Number.isNaN(empId) && displayName) {
              handlerMap.set(empId, displayName);
              handlerNameToIdMap.set(displayName, empId);
            }
          });
        }
      }
      
      // Fetch employees by ID (includes legacy case_handler_id/due_by_id and new ready_to_pay_by when in actual_employee_due mode)
      const uniqueHandlerIds = Array.from(new Set(allHandlerIds));
      if (uniqueHandlerIds.length > 0) {
        console.log('🔍 Collection Due Report - Fetching handler names by ID for', uniqueHandlerIds.length, 'handlers:', uniqueHandlerIds);
        const { data: handlerData, error: handlerError } = await supabase
          .from('tenants_employee')
          .select('id, display_name')
          .in('id', uniqueHandlerIds);
        
        if (handlerError) {
          console.error('❌ Collection Due Report - Error fetching handlers by ID:', handlerError);
        } else {
          console.log('📊 Collection Due Report - Handler data by ID received:', handlerData?.map(emp => ({ id: emp.id, display_name: emp.display_name })));
          console.log('🔍 DEBUG Employee 14 - Employee 14 in handlerData?', handlerData?.some(emp => Number(emp.id) === 14));
          handlerData?.forEach(emp => {
            const empId = Number(emp.id);
            if (!Number.isNaN(empId)) {
              const displayName = emp.display_name?.trim() || `Employee #${emp.id}`;
              handlerMap.set(empId, displayName);
              if (empId === 14) {
                console.log('✅ DEBUG Employee 14 - Added to handlerMap:', { id: empId, displayName });
              }
            }
          });
        }
      }
      
      console.log('✅ Collection Due Report - Handler map created:', Array.from(handlerMap.entries()).map(([id, name]) => ({ id, name })));
      console.log('✅ Collection Due Report - Handler name to ID map:', Array.from(handlerNameToIdMap.entries()));

      // Process payment data
      type PaymentEntry = {
        leadId: string;
        leadType: 'new' | 'legacy';
        amount: number; // Total with VAT
        value: number; // Value without VAT
        currency: string; // Currency code
        handlerId: number | null;
        handlerName: string;
        departmentId: string | null;
        departmentName: string;
        orderCode: string; // Store normalized order code for filtering
      };

      const payments: PaymentEntry[] = [];
      const missingHandlerIds = new Set<number>();

      console.log('🔍 Collection Due Report - Processing new payments...');
      // Process new payments
      (newPayments || []).forEach(payment => {
        const lead = newLeadsMap.get(payment.lead_id);
        if (!lead) return;

        // Get handler based on filter selection
        // Default (case_handler): Use ready_to_pay_by from payment_plans table
        // Actual employee due: Use handler from lead (handler text or case_handler_id)
        let handlerId: number | null = null;
        let handlerName = '—';
        
        if (filters.employeeType === 'actual_employee_due') {
          // Use handler from lead if "Actual Employee Due" is selected
          // For new leads, handler is stored as text (display_name) in the 'handler' column
          if (lead.handler && typeof lead.handler === 'string' && lead.handler.trim() && lead.handler !== '---' && lead.handler.toLowerCase() !== 'not assigned') {
            const handlerNameFromLead = lead.handler.trim();
            // Look up the employee ID by display_name
            handlerId = handlerNameToIdMap.get(handlerNameFromLead) || null;
            if (handlerId === 14) {
              console.log('🔍 DEBUG Employee 14 - Found handlerId 14 in handlerNameToIdMap for:', handlerNameFromLead);
            }
            if (handlerId !== null) {
              handlerName = handlerMap.get(handlerId) || handlerNameFromLead;
            } else {
              // Handler name not found in map, use the name directly
              handlerName = handlerNameFromLead;
            }
          } else if (lead.case_handler_id) {
            // Fallback to case_handler_id if handler text is not available
            handlerId = normalizeHandlerId(lead.case_handler_id);
            if (handlerId !== null) {
              handlerName = handlerMap.get(handlerId) || '—';
            }
          }
        } else {
          // Default (case_handler): Use ready_to_pay_by from payment_plans table
          handlerId = normalizeHandlerId(payment.ready_to_pay_by);
          if (handlerId === 14) {
            console.log('🔍 DEBUG Employee 14 - Found handlerId 14 in new payment ready_to_pay_by:', {
              paymentId: payment.id,
              leadId: payment.lead_id,
              ready_to_pay_by: payment.ready_to_pay_by
            });
          }
          if (handlerId !== null) {
            handlerName = handlerMap.get(handlerId) || '—';
            if (handlerId === 14) {
              console.log('🔍 DEBUG Employee 14 - Handler name from map:', handlerName);
            }
          }
        }

        // Get department from category -> main category -> department
        // Use helper function to handle cases where category is stored as text instead of ID
        const { departmentId, departmentName } = resolveCategoryAndDepartment(
          lead.category, // category text field
          lead.category_id, // category ID
          lead.misc_category // joined misc_category data
        );

        const value = Number(payment.value || 0);
        let vat = Number(payment.value_vat || 0);
        if (!vat && (payment.currency || '₪') === '₪') {
          vat = Math.round(value * 0.18 * 100) / 100;
        }
        const amount = value + vat;
        const orderCode = normalizeOrderCode(payment.payment_order);
        const currency = payment.currency || '₪';

        payments.push({
          leadId: payment.lead_id,
          leadType: 'new',
          amount,
          value, // Store value without VAT
          currency,
          handlerId,
          handlerName,
          departmentId,
          departmentName,
          orderCode,
        });
      });

      console.log('🔍 Collection Due Report - Processing legacy payments...');
      
      // First, identify any missing leads that we need to fetch
      const missingLeadIds = new Set<number>();
      filteredLegacyPayments.forEach(payment => {
        const leadIdKey = payment.lead_id?.toString() || String(payment.lead_id);
        const leadIdNum = typeof payment.lead_id === 'number' ? payment.lead_id : Number(payment.lead_id);
        const lead = legacyLeadsMap.get(leadIdKey) || legacyLeadsMap.get(leadIdNum);
        
        if (!lead && !Number.isNaN(leadIdNum)) {
          missingLeadIds.add(leadIdNum);
        }
      });
      
      // Fetch missing leads if any
      if (missingLeadIds.size > 0) {
        const missingIdsArray = Array.from(missingLeadIds);
        console.log('🔍 Collection Due Report - Fetching', missingIdsArray.length, 'missing legacy leads:', missingIdsArray);
        
        // Try fetching with .in() first
        let { data: missingLeads, error: missingLeadsError } = await supabase
          .from('leads_lead')
          .select(`
            id,
            case_handler_id,
            category_id,
            misc_category!category_id(
              id,
              name,
              parent_id,
              misc_maincategory!parent_id(
                id,
                name,
                department_id,
                tenant_departement!department_id(
                  id,
                  name
                )
              )
            )
          `)
          .in('id', missingIdsArray);
        
        // If no results, try individual queries as a fallback (in case of RLS issues or data inconsistencies)
        if ((!missingLeads || missingLeads.length === 0) && missingIdsArray.length <= 10) {
          console.log('🔍 Collection Due Report - No results with .in(), trying individual queries for:', missingIdsArray);
          const individualResults: any[] = [];
          for (const leadId of missingIdsArray) {
            const { data: singleLead, error: singleError } = await supabase
              .from('leads_lead')
              .select(`
                id,
                case_handler_id,
                category_id,
                misc_category!category_id(
                  id,
                  name,
                  parent_id,
                  misc_maincategory!parent_id(
                    id,
                    name,
                    department_id,
                    tenant_departement!department_id(
                      id,
                      name
                    )
                  )
                )
              `)
              .eq('id', leadId)
              .maybeSingle();
            
            if (singleError) {
              console.error(`❌ Collection Due Report - Error fetching individual lead ${leadId}:`, singleError);
            } else if (singleLead) {
              individualResults.push(singleLead);
              console.log(`✅ Collection Due Report - Found individual lead ${leadId} with case_handler_id:`, singleLead.case_handler_id);
              if (Number(singleLead.case_handler_id) === 14) {
                console.log('✅ DEBUG Employee 14 - Found lead with case_handler_id 14:', leadId);
              }
            } else {
              console.warn(`⚠️ Collection Due Report - Lead ${leadId} not found (does not exist or RLS blocking)`);
            }
          }
          
          if (individualResults.length > 0) {
            missingLeads = individualResults;
            missingLeadsError = null;
            console.log(`✅ Collection Due Report - Found ${individualResults.length} leads via individual queries`);
          }
        }
        
        if (missingLeadsError) {
          console.error('❌ Collection Due Report - Error fetching missing legacy leads:', missingLeadsError);
        } else {
          console.log('✅ Collection Due Report - Fetched', missingLeads?.length || 0, 'missing legacy leads');
          
          // If we didn't find the leads, try a direct query without RLS to see if they exist
          if (missingLeads?.length === 0 && missingIdsArray.length > 0) {
            console.warn('⚠️ Collection Due Report - No leads found for IDs:', missingIdsArray);
            console.warn('⚠️ This might be due to RLS policies or the leads not existing. Payments for these leads will be skipped unless employeeType is "actual_employee_due"');
          }
          
          if (missingLeads) {
            missingLeads.forEach(lead => {
              const key = lead.id?.toString() || String(lead.id);
              legacyLeadsMap.set(key, lead);
              if (typeof lead.id === 'number') {
                legacyLeadsMap.set(lead.id, lead);
              }
              
              // Also collect handler IDs from newly fetched leads
              if (filters.employeeType !== 'actual_employee_due') {
                const handlerId = normalizeHandlerId(lead.case_handler_id);
                if (handlerId !== null && !allHandlerIds.includes(handlerId)) {
                  allHandlerIds.push(handlerId);
                  if (handlerId === 14) {
                    console.log('✅ DEBUG Employee 14 - Added handler ID 14 from newly fetched missing lead:', lead.id);
                  }
                  console.log('✅ Added handler ID from missing lead:', handlerId);
                }
              }
            });
            console.log('🔍 DEBUG Employee 14 - Missing leads with case_handler_id 14:', missingLeads.filter((l: any) => Number(l.case_handler_id) === 14).map((l: any) => ({ id: l.id, case_handler_id: l.case_handler_id })));
            
            // Re-fetch handler data if we discovered new handler IDs from missing leads
            if (filters.employeeType !== 'actual_employee_due') {
              const newHandlerIds = missingLeads
                .map((l: any) => normalizeHandlerId(l.case_handler_id))
                .filter((id): id is number => id !== null && !handlerMap.has(id));
              
              if (newHandlerIds.length > 0) {
                console.log('🔍 Collection Due Report - Re-fetching handler data for newly discovered handler IDs:', newHandlerIds);
                console.log('🔍 DEBUG Employee 14 - Is employee 14 in newHandlerIds?', newHandlerIds.includes(14));
                const { data: newHandlerData, error: newHandlerError } = await supabase
                  .from('tenants_employee')
                  .select('id, display_name')
                  .in('id', newHandlerIds);
                
                if (newHandlerError) {
                  console.error('❌ Collection Due Report - Error re-fetching handlers:', newHandlerError);
                } else {
                  console.log('📊 Collection Due Report - New handler data received:', newHandlerData?.map(emp => ({ id: emp.id, display_name: emp.display_name })));
                  newHandlerData?.forEach(emp => {
                    const empId = Number(emp.id);
                    if (!Number.isNaN(empId)) {
                      const displayName = emp.display_name?.trim() || `Employee #${emp.id}`;
                      handlerMap.set(empId, displayName);
                      if (empId === 14) {
                        console.log('✅ DEBUG Employee 14 - Added to handlerMap after re-fetch:', { id: empId, displayName });
                      }
                    }
                  });
                }
              }
            }
          }
        }
      }
      
      // After fetching missing leads, we need to fetch their handler names if we haven't already
      // This will be handled by the existing handler fetching logic below, but we need to ensure
      // allHandlerIds includes the handler IDs from missing leads
      
      // Process legacy payments - use due_date if available, otherwise use date (like CollectionFinancesReport)
      filteredLegacyPayments.forEach(payment => {
        // Try both string and number keys for lead_id lookup
        const leadIdKey = payment.lead_id?.toString() || String(payment.lead_id);
        const leadIdNum = typeof payment.lead_id === 'number' ? payment.lead_id : Number(payment.lead_id);
        let lead = legacyLeadsMap.get(leadIdKey) || legacyLeadsMap.get(leadIdNum);
        
        // DEBUG: Check specifically for lead 183061
        const isLead183061 = leadIdNum === 183061 || leadIdKey === '183061';
        if (isLead183061) {
          console.log('🔍 DEBUG Lead 183061 - Processing payment:', {
            paymentId: payment.id,
            lead_id: payment.lead_id,
            leadIdKey,
            leadIdNum,
            leadFound: !!lead,
            employeeType: filters.employeeType,
            due_by_id: payment.due_by_id,
            case_handler_id: lead?.case_handler_id
          });
        }
        
        // Get handler based on filter selection
        // Default (case_handler): Use due_by_id from finances_paymentplanrow table
        // Actual employee due: Use case_handler_id from lead
        let handlerId: number | null = null;
        let handlerName = '—';
        
        if (filters.employeeType === 'actual_employee_due') {
          // Use case_handler_id from lead if "Actual Employee Due" is selected
          // If lead doesn't exist, we can't get case_handler_id, so skip this payment
          if (!lead) {
            if (isLead183061) {
              console.error('❌ DEBUG Lead 183061 - PAYMENT SKIPPED: Lead not found in legacyLeadsMap!', {
                payment_lead_id: payment.lead_id,
                payment_lead_id_type: typeof payment.lead_id,
                leadIdKey,
                leadIdNum,
                available_keys_sample: Array.from(legacyLeadsMap.keys()).slice(0, 10),
                note: 'Skipping payment because we need case_handler_id from lead and lead cannot be fetched'
              });
            }
            console.warn('⚠️ Collection Due Report - Legacy lead not found for payment (cannot get case_handler_id):', {
              payment_lead_id: payment.lead_id,
              payment_lead_id_type: typeof payment.lead_id,
              leadIdKey,
              leadIdNum,
              available_keys: Array.from(legacyLeadsMap.keys()).slice(0, 5),
              note: 'Skipping payment because we need case_handler_id from lead and lead cannot be fetched'
            });
            return;
          }
          handlerId = normalizeHandlerId(lead.case_handler_id);
          if (handlerId === 14 || lead.case_handler_id === 14) {
            console.log('🔍 DEBUG Employee 14 - Found handlerId 14 in legacy lead case_handler_id:', {
              leadId: payment.lead_id,
              case_handler_id: lead?.case_handler_id,
              normalizedHandlerId: handlerId
            });
          }
          if (isLead183061) {
            console.log('🔍 DEBUG Lead 183061 - Using case_handler_id mode (actual employee due), handlerId:', handlerId, 'from case_handler_id:', lead.case_handler_id);
          }
        } else {
          // Default (case_handler): Use due_by_id from finances_paymentplanrow table
          handlerId = normalizeHandlerId(payment.due_by_id);
          if (handlerId === 14 || payment.due_by_id === 14) {
            console.log('🔍 DEBUG Employee 14 - Found handlerId 14 in legacy payment due_by_id:', {
              paymentId: payment.id,
              leadId: payment.lead_id,
              due_by_id: payment.due_by_id,
              normalizedHandlerId: handlerId
            });
          }
          if (isLead183061) {
            console.log('🔍 DEBUG Lead 183061 - Using due_by_id mode (default), handlerId:', handlerId);
          }
        }
        
        // Note: handlerId can be null if no handler is assigned - we still want to process the payment
        // with handlerName set to '—' to show unassigned payments
        
        if (handlerId !== null) {
          handlerName = handlerMap.get(handlerId) || '—';
          if (handlerId === 14) {
            console.log('🔍 DEBUG Employee 14 - Handler name from map:', handlerName);
          }
          if (handlerName === '—') {
            // Track missing handler IDs to fetch them
            missingHandlerIds.add(handlerId);
            if (handlerId === 14) {
              console.warn('⚠️ DEBUG Employee 14 - Employee 14 handler not found in map, added to missingHandlerIds');
            }
            console.warn('⚠️ Collection Due Report - Legacy lead handler not found in map, will fetch:', {
              handlerId,
              handlerIdType: typeof handlerId,
              employeeType: filters.employeeType,
              case_handler_id: lead?.case_handler_id,
              due_by_id: payment.due_by_id,
              mapKeys: Array.from(handlerMap.keys()),
              leadId: payment.lead_id
            });
          }
        }

        // Get department from category -> main category -> department
        // Use helper function to handle cases where category is stored as text instead of ID
        const { departmentId, departmentName } = resolveCategoryAndDepartment(
          lead.category, // category text field (for legacy leads)
          lead.category_id, // category ID
          lead.misc_category // joined misc_category data
        );

        // Use value for legacy payments (value_base may be null/0, value contains the actual amount)
        const value = Number(payment.value || payment.value_base || 0);
        let vat = Number(payment.vat_value || 0);
        
        // Get currency from accounting_currencies relation (joined via currency_id)
        const accountingCurrency: any = payment.accounting_currencies 
          ? (Array.isArray(payment.accounting_currencies) ? payment.accounting_currencies[0] : payment.accounting_currencies) 
          : null;
        
        // Map currency_id to currency symbol/name (currency_id 1 = NIS, 2 = EUR, 3 = USD, 4 = GBP)
        let currency = '₪'; // Default to NIS
        if (accountingCurrency?.name) {
          currency = accountingCurrency.name;
        } else if (accountingCurrency?.iso_code) {
          currency = accountingCurrency.iso_code;
        } else if (payment.currency_id) {
          switch (payment.currency_id) {
            case 1: currency = '₪'; break; // NIS
            case 2: currency = '€'; break; // EUR
            case 3: currency = '$'; break; // USD
            case 4: currency = '£'; break; // GBP
            default: currency = '₪'; break;
          }
        }
        
        // Calculate VAT if not provided and currency is NIS (₪)
        if (!vat && (currency === '₪' || currency === 'ILS')) {
          vat = Math.round(value * 0.18 * 100) / 100;
        }
        const amount = value + vat;
        const orderCode = normalizeOrderCode(payment.order);

        // DEBUG: Check specifically for lead 183061 (reuse variable declared earlier in loop)
        if (isLead183061) {
          console.log('🔍 DEBUG Lead 183061 - Adding payment to payments array:', {
            leadId: `legacy_${payment.lead_id}`,
            amount,
            value,
            currency,
            handlerId,
            handlerName,
            departmentId,
            departmentName
          });
        }

        payments.push({
          leadId: `legacy_${payment.lead_id}`,
          leadType: 'legacy',
          amount,
          value, // Store value without VAT
          currency,
          handlerId,
          handlerName,
          departmentId,
          departmentName,
          orderCode,
        });
      });
      
      // DEBUG: Final check for lead 183061 in payments array
      const finalPayments183061 = payments.filter(p => p.leadId?.includes('183061'));
      console.log('🔍 DEBUG Lead 183061 - Final payments in array:', finalPayments183061.length, finalPayments183061.map(p => ({
        leadId: p.leadId,
        handlerId: p.handlerId,
        handlerName: p.handlerName,
        amount: p.amount,
        value: p.value
      })));

      // After processing all payments, check if we found any new handler IDs that weren't in our initial collection
      // This can happen if we fetched missing leads that had different handler IDs
      const handlerIdsFromPayments = new Set(payments.map(p => p.handlerId).filter((id): id is number => id !== null));
      const missingHandlerIdsFromPayments = Array.from(handlerIdsFromPayments).filter(id => !allHandlerIds.includes(id));
      
      if (missingHandlerIdsFromPayments.length > 0) {
        console.log('🔍 Collection Due Report - Found handler IDs in payments that were not in initial collection:', missingHandlerIdsFromPayments);
        console.log('🔍 DEBUG Employee 14 - Is employee 14 in missingHandlerIdsFromPayments?', missingHandlerIdsFromPayments.includes(14));
        // Add these to allHandlerIds so they get fetched
        missingHandlerIdsFromPayments.forEach(id => allHandlerIds.push(id));
      }

      console.log('✅ Collection Due Report - Total payments processed:', payments.length);
      
      // Log all handler IDs in payments
      const handlerIdsInPayments = payments.map(p => p.handlerId).filter(Boolean);
      console.log('📊 Collection Due Report - Handler IDs in payments:', handlerIdsInPayments);
      console.log('🔍 DEBUG Employee 14 - Employee 14 in payments handlerIds?', handlerIdsInPayments.includes(14));
      const paymentsWith14All = payments.filter(p => p.handlerId === 14);
      console.log('🔍 DEBUG Employee 14 - All payments with handlerId 14:', paymentsWith14All.length, paymentsWith14All);
      console.log('📊 Collection Due Report - Payment entries:', payments.map(p => ({ handlerId: p.handlerId, handlerName: p.handlerName, leadId: p.leadId })));

      // Fetch any missing handler IDs that appeared in payments but weren't in our initial map
      if (missingHandlerIds.size > 0) {
        const missingIdsArray = Array.from(missingHandlerIds);
        console.log('🔍 Collection Due Report - Fetching', missingIdsArray.length, 'missing handler IDs:', missingIdsArray);
        const { data: missingHandlerData, error: missingHandlerError } = await supabase
          .from('tenants_employee')
          .select('id, display_name')
          .in('id', missingIdsArray);
        
        if (!missingHandlerError && missingHandlerData) {
          missingHandlerData.forEach(emp => {
            const empId = Number(emp.id);
            if (!Number.isNaN(empId)) {
              const displayName = emp.display_name?.trim() || `Employee #${emp.id}`;
              handlerMap.set(empId, displayName);
              console.log('✅ Collection Due Report - Added missing handler to map:', { id: empId, name: displayName });
            }
          });
          
          // Update handler names in payments array for missing handlers
          payments.forEach(payment => {
            if (payment.handlerId !== null && missingHandlerIds.has(payment.handlerId) && payment.handlerName === '—') {
              payment.handlerName = handlerMap.get(payment.handlerId) || '—';
              if (payment.handlerId === 14) {
                console.log('✅ DEBUG Employee 14 - Updated payment handler name after fetching missing:', { handlerId: payment.handlerId, handlerName: payment.handlerName });
              }
              console.log('✅ Collection Due Report - Updated payment handler name:', { handlerId: payment.handlerId, handlerName: payment.handlerName });
            }
          });
        }
      }

      // Only filter by ready_to_pay and due_date - no other filters applied
      // All payments marked as ready to pay with due_date in the date range are shown
      let filteredPayments = payments;
      console.log('✅ Collection Due Report - Payments (filtered only by ready_to_pay and due_date):', filteredPayments.length);

      // Create a map of leadId -> payment value and currency for drawer display (from filtered payments)
      const paymentValueMapLocal = new Map<string, { value: number; currency: string }>();
      filteredPayments.forEach(payment => {
        // For legacy leads, the leadId is stored as "legacy_XXX"
        const leadIdKey = payment.leadId;
        const existing = paymentValueMapLocal.get(leadIdKey);
        if (existing) {
          // If multiple payments exist for the same lead, sum them
          paymentValueMapLocal.set(leadIdKey, {
            value: existing.value + payment.value,
            currency: payment.currency // Use the currency from the payment
          });
        } else {
          paymentValueMapLocal.set(leadIdKey, {
            value: payment.value,
            currency: payment.currency
          });
        }
      });
      setPaymentValueMap(paymentValueMapLocal);

      // Group by employee
      // Cases count uses a Set to ensure each lead is counted only once, even if there are multiple payments for the same lead
      const employeeMap = new Map<string, { handlerId: number | null; handlerName: string; departmentName: string; cases: Set<string>; applicantsLeads: Set<string>; applicants: number; total: number }>();
      
      // Debug: Check if any payments have handlerId 14
      const paymentsWith14 = filteredPayments.filter(p => p.handlerId === 14);
      console.log('🔍 DEBUG Employee 14 - Payments with handlerId 14 in filteredPayments:', paymentsWith14.length, paymentsWith14);
      
      filteredPayments.forEach(payment => {
        if (payment.handlerId === 14) {
          console.log('🔍 DEBUG Employee 14 - Processing payment for employee 14:', {
            leadId: payment.leadId,
            handlerId: payment.handlerId,
            handlerName: payment.handlerName,
            value: payment.value,
            amount: payment.amount
          });
        }
        
        const key = payment.handlerId?.toString() || 'unassigned';
        if (!employeeMap.has(key)) {
          employeeMap.set(key, {
            handlerId: payment.handlerId,
            handlerName: payment.handlerName,
            departmentName: payment.departmentName,
            cases: new Set(), // Set ensures unique lead IDs - no duplicates
            applicantsLeads: new Set(),
            applicants: 0,
            total: 0,
          });
          if (payment.handlerId === 14) {
            console.log('✅ DEBUG Employee 14 - Created new entry in employeeMap:', {
              key,
              handlerId: payment.handlerId,
              handlerName: payment.handlerName,
              departmentName: payment.departmentName
            });
          }
        }
        const entry = employeeMap.get(key)!;
        entry.cases.add(payment.leadId); // Set automatically prevents duplicate lead IDs
        // Convert value to NIS before adding to total
        // Normalize currency: convert symbols to codes for convertToNIS
        let currencyForConversion = payment.currency || 'NIS';
        if (currencyForConversion === '₪') currencyForConversion = 'NIS';
        else if (currencyForConversion === '€') currencyForConversion = 'EUR';
        else if (currencyForConversion === '$') currencyForConversion = 'USD';
        else if (currencyForConversion === '£') currencyForConversion = 'GBP';
        const valueInNIS = convertToNIS(payment.value, currencyForConversion);
        entry.total += valueInNIS; // Use value converted to NIS
        
        if (payment.handlerId === 14) {
          console.log('🔍 DEBUG Employee 14 - Updated entry:', {
            cases: entry.cases.size,
            total: entry.total,
            handlerName: entry.handlerName
          });
        }

        // Add applicants count only once per lead
        if (!entry.applicantsLeads.has(payment.leadId)) {
          entry.applicantsLeads.add(payment.leadId);
          if (payment.leadType === 'new') {
            const applicants = applicantsCountMap.get(payment.leadId) || 0;
            entry.applicants += applicants;
          } else {
            const legacyId = payment.leadId.replace('legacy_', '');
            const applicants = legacyApplicantsCountMap.get(legacyId) || 0;
            entry.applicants += applicants;
          }
        }
      });

      // Final check: fetch any handler IDs that appear in employee map but have "--" as name
      const missingHandlerIdsFinal = new Set<number>();
      employeeMap.forEach((entry, key) => {
        if (entry.handlerId !== null && entry.handlerName === '—') {
          missingHandlerIdsFinal.add(entry.handlerId);
        }
      });
      
      if (missingHandlerIdsFinal.size > 0) {
        const missingIdsFinalArray = Array.from(missingHandlerIdsFinal);
        console.log('🔍 Collection Due Report - Found handler IDs with "--" in employee map, fetching:', missingIdsFinalArray);
        const { data: missingHandlerDataFinal, error: missingHandlerErrorFinal } = await supabase
          .from('tenants_employee')
          .select('id, display_name')
          .in('id', missingIdsFinalArray);
        
        if (!missingHandlerErrorFinal && missingHandlerDataFinal) {
          missingHandlerDataFinal.forEach(emp => {
            const empId = Number(emp.id);
            if (!Number.isNaN(empId)) {
              const displayName = emp.display_name?.trim() || `Employee #${emp.id}`;
              handlerMap.set(empId, displayName);
              // Update the employee map entry
              const key = empId.toString();
              const entry = employeeMap.get(key);
              if (entry) {
                entry.handlerName = displayName;
                console.log('✅ Collection Due Report - Updated employee map entry:', { handlerId: empId, handlerName: displayName });
              }
            }
          });
        }
      }

      // Fetch department information from tenants_employee for all handlers
      const handlerIdsWithDepartments = Array.from(employeeMap.values())
        .map(entry => entry.handlerId)
        .filter((id): id is number => id !== null);
      
      if (handlerIdsWithDepartments.length > 0) {
        console.log('🔍 Collection Due Report - Fetching departments from tenants_employee for', handlerIdsWithDepartments.length, 'handlers');
        const { data: employeeDepartmentData, error: employeeDepartmentError } = await supabase
          .from('tenants_employee')
          .select(`
            id,
            display_name,
            department_id,
            tenant_departement!department_id (
              id,
              name
            )
          `)
          .in('id', handlerIdsWithDepartments);
        
        if (!employeeDepartmentError && employeeDepartmentData) {
          console.log('📊 Collection Due Report - Employee department data received:', employeeDepartmentData.length, 'records');
          
          // Create maps for department name and display name
          const handlerDepartmentMap = new Map<number, string>();
          const handlerDisplayNameMap = new Map<number, string>();
          
          employeeDepartmentData.forEach(emp => {
            const empId = Number(emp.id);
            if (!Number.isNaN(empId)) {
              // Map display_name
              const displayName = emp.display_name?.trim() || `Employee #${emp.id}`;
              handlerDisplayNameMap.set(empId, displayName);
              
              // Map department
              const department = emp.tenant_departement;
              if (department) {
                const dept = Array.isArray(department) ? department[0] : department;
                const departmentName = dept?.name || '—';
                handlerDepartmentMap.set(empId, departmentName);
                console.log('✅ Collection Due Report - Mapped handler to department:', { handlerId: empId, departmentName });
              } else {
                handlerDepartmentMap.set(empId, '—');
              }
            }
          });
          
          // Update employeeMap entries with correct department and display_name from tenants_employee
          employeeMap.forEach((entry, key) => {
            if (entry.handlerId !== null) {
              // Update display_name
              const correctDisplayName = handlerDisplayNameMap.get(entry.handlerId);
              if (correctDisplayName !== undefined) {
                entry.handlerName = correctDisplayName;
                console.log('✅ Collection Due Report - Updated handler name in employee map:', { handlerId: entry.handlerId, handlerName: correctDisplayName });
              }
              
              // Update department
              const correctDepartment = handlerDepartmentMap.get(entry.handlerId);
              if (correctDepartment !== undefined) {
                entry.departmentName = correctDepartment;
                console.log('✅ Collection Due Report - Updated department in employee map:', { handlerId: entry.handlerId, departmentName: correctDepartment });
              }
            }
          });
        } else if (employeeDepartmentError) {
          console.error('❌ Collection Due Report - Error fetching employee departments:', employeeDepartmentError);
        }
      }

      // Store maps for drawer access
      setEmployeeMapStore(employeeMap);
      
      // Debug: Check if employee 14 is in employeeMap
      const employee14Entry = Array.from(employeeMap.entries()).find(([key, entry]) => entry.handlerId === 14);
      console.log('🔍 DEBUG Employee 14 - Employee 14 in employeeMap?', employee14Entry ? 'YES' : 'NO', employee14Entry);
      console.log('🔍 DEBUG Employee 14 - All handlerIds in employeeMap:', Array.from(employeeMap.values()).map(e => e.handlerId));
      
      const employeeDataArray = Array.from(employeeMap.values()).map(entry => ({
        employee: entry.handlerName,
        department: entry.departmentName,
        cases: entry.cases.size,
        applicants: entry.applicants,
        total: entry.total,
        handlerId: entry.handlerId, // Store handlerId for drawer access
        leadIds: Array.from(entry.cases), // Store leadIds for drawer
      })).sort((a, b) => b.total - a.total);

      // Debug: Check if employee 14 is in employeeDataArray
      const employee14InArray = employeeDataArray.find(e => e.handlerId === 14);
      console.log('🔍 DEBUG Employee 14 - Employee 14 in employeeDataArray?', employee14InArray ? 'YES' : 'NO', employee14InArray);
      console.log('🔍 DEBUG Employee 14 - All handlerIds in employeeDataArray:', employeeDataArray.map(e => e.handlerId));

      console.log('✅ Collection Due Report - Employee data array:', employeeDataArray.length, 'employees');
      console.log('📊 Collection Due Report - Employee data:', employeeDataArray);
      console.log('📊 Collection Due Report - Employee map entries:', Array.from(employeeMap.entries()).map(([key, entry]) => ({ key, handlerId: entry.handlerId, handlerName: entry.handlerName })));

      // Group by department - use lead's category department (not employee's department)
      // Match leads by category to department, same as signed agreements table in Dashboard
      const departmentMap = new Map<string, { departmentName: string; cases: Set<string>; applicantsLeads: Set<string>; applicants: number; total: number }>();
      filteredPayments.forEach(payment => {
        // Get department from lead's category -> main category -> department
        // This is already extracted in payment.departmentId and payment.departmentName
        const departmentName = payment.departmentName || '—';
        const key = departmentName;
        
        if (!departmentMap.has(key)) {
          departmentMap.set(key, {
            departmentName: departmentName,
            cases: new Set(),
            applicantsLeads: new Set(),
            applicants: 0,
            total: 0,
          });
        }
        const entry = departmentMap.get(key)!;
        entry.cases.add(payment.leadId);
        // Convert value to NIS before adding to total
        // Normalize currency: convert symbols to codes for convertToNIS
        let currencyForConversion = payment.currency || 'NIS';
        if (currencyForConversion === '₪') currencyForConversion = 'NIS';
        else if (currencyForConversion === '€') currencyForConversion = 'EUR';
        else if (currencyForConversion === '$') currencyForConversion = 'USD';
        else if (currencyForConversion === '£') currencyForConversion = 'GBP';
        const valueInNIS = convertToNIS(payment.value, currencyForConversion);
        entry.total += valueInNIS; // Use value converted to NIS

        // Add applicants count only once per lead
        if (!entry.applicantsLeads.has(payment.leadId)) {
          entry.applicantsLeads.add(payment.leadId);
          if (payment.leadType === 'new') {
            const applicants = applicantsCountMap.get(payment.leadId) || 0;
            entry.applicants += applicants;
          } else {
            const legacyId = payment.leadId.replace('legacy_', '');
            const applicants = legacyApplicantsCountMap.get(legacyId) || 0;
            entry.applicants += applicants;
          }
        }
      });

      // Store department map for drawer access
      setDepartmentMapStore(departmentMap);
      
      const departmentDataArray = Array.from(departmentMap.values()).map(entry => ({
        department: entry.departmentName,
        cases: entry.cases.size,
        applicants: entry.applicants,
        total: entry.total,
        leadIds: Array.from(entry.cases), // Store leadIds for drawer
      })).sort((a, b) => b.total - a.total);

      console.log('✅ Collection Due Report - Department data array:', departmentDataArray.length, 'departments');
      console.log('📊 Collection Due Report - Department data:', departmentDataArray);

      const calculatedTotal = employeeDataArray.reduce((sum, item) => sum + item.total, 0);
      console.log('✅ Collection Due Report - Total due:', calculatedTotal);

      setEmployeeData(employeeDataArray);
      setDepartmentData(departmentDataArray);
      setTotalDue(calculatedTotal);
    } catch (error) {
      console.error('Error fetching collection due data:', error);
      alert('Failed to fetch collection due data.');
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('he-IL', {
      style: 'currency',
      currency: 'ILS',
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(amount);
  };

  const handleOpenDrawer = async (leadIds: string[], title: string) => {
    setDrawerLoading(true);
    setIsDrawerOpen(true);
    setDrawerTitle(title);
    
    try {
      // Separate new and legacy leadIds
      const newLeadIds: string[] = [];
      const legacyLeadIds: number[] = [];
      
      leadIds.forEach(leadId => {
        if (leadId.startsWith('legacy_')) {
          const legacyId = Number(leadId.replace('legacy_', ''));
          if (!Number.isNaN(legacyId)) {
            legacyLeadIds.push(legacyId);
          }
        } else {
          newLeadIds.push(leadId);
        }
      });

      const leadsData: any[] = [];

      // Fetch new leads
      if (newLeadIds.length > 0) {
        const { data: newLeads, error: newLeadsError } = await supabase
          .from('leads')
          .select(`
            id,
            lead_number,
            name,
            category_id,
            topic,
            balance,
            balance_currency
          `)
          .in('id', newLeadIds);

        if (newLeadsError) {
          console.error('Error fetching new leads for drawer:', newLeadsError);
        } else {
          // Fetch applicants count for new leads
          const { data: contacts, error: contactsError } = await supabase
            .from('contacts')
            .select('lead_id')
            .in('lead_id', newLeadIds)
            .eq('is_persecuted', false);

          const applicantsCountMap = new Map<string, number>();
          if (!contactsError && contacts) {
            contacts.forEach(contact => {
              const count = applicantsCountMap.get(contact.lead_id) || 0;
              applicantsCountMap.set(contact.lead_id, count + 1);
            });
          }

          newLeads?.forEach(lead => {
            // Get payment value from paymentValueMap instead of lead balance
            const paymentInfo = paymentValueMap.get(lead.id);
            const paymentValue = paymentInfo?.value || 0;
            const paymentCurrency = paymentInfo?.currency || lead.balance_currency || '₪';
            
            leadsData.push({
              leadId: lead.id,
              leadNumber: lead.lead_number, // For new leads, use lead_number column
              clientName: lead.name,
              categoryId: lead.category_id,
              topic: lead.topic || '—',
              applicants: applicantsCountMap.get(lead.id) || 0,
              value: paymentValue, // Use payment value instead of lead balance
              currency: paymentCurrency,
              leadType: 'new',
            });
          });
        }
      }

      // Fetch legacy leads
      if (legacyLeadIds.length > 0) {
        const { data: legacyLeads, error: legacyLeadsError } = await supabase
          .from('leads_lead')
          .select(`
            id,
            name,
            category_id,
            topic,
            total,
            currency_id,
            no_of_applicants,
            accounting_currencies!leads_lead_currency_id_fkey(name, iso_code)
          `)
          .in('id', legacyLeadIds);

        if (legacyLeadsError) {
          console.error('Error fetching legacy leads for drawer:', legacyLeadsError);
        } else {
          legacyLeads?.forEach(lead => {
            const accountingCurrency: any = lead.accounting_currencies 
              ? (Array.isArray(lead.accounting_currencies) ? lead.accounting_currencies[0] : lead.accounting_currencies)
              : null;
            
            const currency = accountingCurrency?.name || accountingCurrency?.iso_code ||
              (lead.currency_id === 2 ? '€' : 
               lead.currency_id === 3 ? '$' : 
               lead.currency_id === 4 ? '£' : '₪');

            // Handle bigint null values for applicants
            const applicantsCount = lead.no_of_applicants !== null && lead.no_of_applicants !== undefined
              ? Number(lead.no_of_applicants)
              : 0;

            // Get payment value from paymentValueMap instead of lead total
            const legacyLeadIdKey = `legacy_${lead.id}`;
            const paymentInfo = paymentValueMap.get(legacyLeadIdKey);
            const paymentValue = paymentInfo?.value || 0;
            const paymentCurrency = paymentInfo?.currency || currency;
            
            leadsData.push({
              leadId: lead.id,
              leadNumber: lead.id.toString(), // For legacy leads, use id column as lead number
              clientName: lead.name,
              categoryId: lead.category_id,
              topic: lead.topic || '—',
              applicants: applicantsCount,
              value: paymentValue, // Use payment value instead of lead total
              currency: paymentCurrency,
              leadType: 'legacy',
            });
          });
        }
      }

      setDrawerLeads(leadsData);
    } catch (error) {
      console.error('Error fetching leads for drawer:', error);
      setDrawerLeads([]);
    } finally {
      setDrawerLoading(false);
    }
  };

  const handleCloseDrawer = () => {
    setIsDrawerOpen(false);
    setDrawerTitle('');
    setDrawerLeads([]);
  };

  return (
    <div>
      {/* Filters */}
      <div className="bg-white mb-8">
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4 items-end">
          <div className="form-control">
            <label className="label mb-2"><span className="label-text">From date:</span></label>
            <input
              type="date"
              className="input input-bordered"
              value={filters.fromDate}
              onChange={e => handleFilterChange('fromDate', e.target.value)}
            />
          </div>
          <div className="form-control">
            <label className="label mb-2"><span className="label-text">To date:</span></label>
            <input
              type="date"
              className="input input-bordered"
              value={filters.toDate}
              onChange={e => handleFilterChange('toDate', e.target.value)}
            />
          </div>
          <div className="form-control">
            <label className="label mb-2"><span className="label-text">Category:</span></label>
            <select
              className="select select-bordered"
              value={filters.category}
              onChange={e => handleFilterChange('category', e.target.value)}
            >
              <option value="">---------</option>
              {categories.map(cat => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
          </div>
          <div className="form-control">
            <label className="label mb-2"><span className="label-text">Order:</span></label>
            <select
              className="select select-bordered"
              value={filters.order}
              onChange={e => handleFilterChange('order', e.target.value)}
            >
              <option value="">- ALL -</option>
              <option value="1">First Payment</option>
              <option value="5">Intermediate Payment</option>
              <option value="9">Final Payment</option>
            </select>
          </div>
          <div className="form-control">
            <label className="label mb-2"><span className="label-text">Department:</span></label>
            <select
              className="select select-bordered"
              value={filters.department}
              onChange={e => handleFilterChange('department', e.target.value)}
            >
              <option value="">All</option>
              {departments.map(dept => (
                <option key={dept.id} value={dept.id}>{dept.name}</option>
              ))}
            </select>
          </div>
          <div className="form-control">
            <label className="label mb-2"><span className="label-text">By employee:</span></label>
            <select
              className="select select-bordered"
              value={filters.employeeType}
              onChange={e => {
                handleFilterChange('employeeType', e.target.value);
                handleFilterChange('employee', ''); // Reset employee filter when changing type
              }}
            >
              <option value="case_handler">Case Handler</option>
              <option value="actual_employee_due">Actual Employee Due</option>
            </select>
          </div>
        </div>
        <div className="mt-4">
          <button
            className="btn btn-primary"
            onClick={handleSearch}
            disabled={loading}
          >
            {loading ? 'Loading...' : 'Show'}
          </button>
        </div>
      </div>

      {/* Results */}
      {searchPerformed && (
        <div>
          {/* Total Due Summary */}
          <div className="mb-6">
            <span className="text-lg font-semibold mr-2">Total Due:</span>
            <div className="bg-green-500 text-white px-4 py-2 rounded-lg inline-block">
              <span className="text-2xl font-bold">{formatCurrency(totalDue)}</span>
            </div>
          </div>

          {/* By Employee Table */}
          <div className="-mx-4 sm:-mx-6 md:mx-0 mb-6">
            <div className="px-4 sm:px-6 md:px-0">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold">By Employee</h3>
                <button
                  onClick={exportEmployeeTable}
                  className="btn btn-sm btn-outline btn-primary flex items-center gap-2"
                  title="Export to Excel"
                >
                  <ArrowDownTrayIcon className="w-4 h-4" />
                  <span className="hidden sm:inline">Export Excel</span>
                </button>
              </div>
              <div className="overflow-x-auto -mx-4 sm:-mx-6 md:mx-0">
                <div className="px-4 sm:px-6 md:px-0">
                  <table className="table w-full">
                  <thead>
                    <tr>
                      <th className="text-left">Employee</th>
                      <th className="text-left">Department</th>
                      <th className="text-center">Cases</th>
                      <th className="text-center">Applicants</th>
                      <th className="text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={5} className="text-center py-4">
                          <span className="loading loading-spinner loading-md"></span>
                        </td>
                      </tr>
                    ) : employeeData.length > 0 ? (
                      employeeData.map((row, index) => (
                        <tr key={index}>
                          <td className="text-left font-medium">{row.employee}</td>
                          <td className="text-left">{row.department}</td>
                          <td className="text-center">{row.cases}</td>
                          <td className="text-center">{row.applicants}</td>
                          <td className="text-right font-semibold">
                            {formatCurrency(row.total)}
                            <InformationCircleIcon 
                              className="w-4 h-4 inline-block ml-2 text-gray-400 hover:text-primary cursor-pointer transition-colors" 
                              onClick={() => handleOpenDrawer(row.leadIds || [], `${row.employee} - Leads`)}
                              title="View leads"
                            />
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} className="text-center py-4 text-gray-500">No data found</td>
                      </tr>
                    )}
                  </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>

          {/* By Department Table */}
          <div className="-mx-4 sm:-mx-6 md:mx-0">
            <div className="px-4 sm:px-6 md:px-0">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold">By Department</h3>
                <button
                  onClick={exportDepartmentTable}
                  className="btn btn-sm btn-outline btn-primary flex items-center gap-2"
                  title="Export to Excel"
                >
                  <ArrowDownTrayIcon className="w-4 h-4" />
                  <span className="hidden sm:inline">Export Excel</span>
                </button>
              </div>
              <div className="overflow-x-auto -mx-4 sm:-mx-6 md:mx-0">
                <div className="px-4 sm:px-6 md:px-0">
                  <table className="table w-full">
                  <thead>
                    <tr>
                      <th className="text-left">Department</th>
                      <th className="text-center">Cases</th>
                      <th className="text-center">Applicants</th>
                      <th className="text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={4} className="text-center py-4">
                          <span className="loading loading-spinner loading-md"></span>
                        </td>
                      </tr>
                    ) : departmentData.length > 0 ? (
                      departmentData.map((row, index) => (
                        <tr key={index}>
                          <td className="text-left font-medium">{row.department}</td>
                          <td className="text-center">{row.cases}</td>
                          <td className="text-center">{row.applicants}</td>
                          <td className="text-right font-semibold">
                            {formatCurrency(row.total)}
                            <InformationCircleIcon 
                              className="w-4 h-4 inline-block ml-2 text-gray-400 hover:text-primary cursor-pointer transition-colors" 
                              onClick={() => handleOpenDrawer(row.leadIds || [], `${row.department} - Leads`)}
                              title="View leads"
                            />
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={4} className="text-center py-4 text-gray-500">No data found</td>
                      </tr>
                    )}
                  </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Leads Drawer */}
      {isDrawerOpen && (
        <div className="fixed inset-0 z-[1000] flex">
          {/* Overlay */}
          <div 
            className="fixed inset-0 bg-black/30 transition-opacity duration-300" 
            onClick={handleCloseDrawer}
          />
          
          {/* Drawer */}
          <div className="ml-auto w-full max-w-4xl bg-white h-full shadow-2xl flex flex-col z-[1100]">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div>
                <h2 className="text-xl font-bold text-gray-900">{drawerTitle}</h2>
                <p className="text-sm text-gray-500 mt-1">
                  {drawerLeads.length} {drawerLeads.length === 1 ? 'lead' : 'leads'}
                </p>
              </div>
              <button
                className="btn btn-ghost btn-circle"
                onClick={handleCloseDrawer}
                aria-label="Close drawer"
              >
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
              {drawerLoading ? (
                <div className="flex justify-center items-center py-12">
                  <span className="loading loading-spinner loading-lg"></span>
                </div>
              ) : drawerLeads.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="table w-full">
                    <thead>
                      <tr className="bg-gray-50">
                        <th className="text-left">Lead</th>
                        <th className="text-left">Category</th>
                        <th className="text-left">Topic</th>
                        <th className="text-center">Applicants</th>
                        <th className="text-right">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {drawerLeads.map((lead, index) => (
                        <tr 
                          key={index} 
                          className="hover:bg-gray-50 cursor-pointer transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (lead.leadNumber) {
                              navigate(`/clients/${lead.leadNumber}`);
                            }
                          }}
                        >
                          <td className="text-left">
                            <div>
                              <div className="font-semibold">#{lead.leadNumber}</div>
                              <div className="text-sm text-gray-600">{lead.clientName}</div>
                            </div>
                          </td>
                          <td className="text-left">{getCategoryName(lead.categoryId) || '—'}</td>
                          <td className="text-left">{lead.topic || '—'}</td>
                          <td className="text-center">{lead.applicants || 0}</td>
                          <td className="text-right">
                            {lead.value > 0 
                              ? `${lead.value.toLocaleString()} ${lead.currency}`
                              : '—'
                            }
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-12 text-gray-500">
                  No leads found
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
const SumActiveReport = () => <div className="p-6">Sum Active Cases Content</div>;

const ContributionAllReport = () => {
  const today = new Date();
  const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
  const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().split('T')[0];

  const [filters, setFilters] = useState({
    fromDate: firstDayOfMonth,
    toDate: lastDayOfMonth,
  });
  const [departmentData, setDepartmentData] = useState<Map<string, { employees: any[]; supervisor: { id: number; name: string } | null }>>(new Map());
  const [loading, setLoading] = useState(false);
  const [searchPerformed, setSearchPerformed] = useState(false);
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    const fetchDepartments = async () => {
      const { data: deptData } = await supabase
        .from('tenant_departement')
        .select('id, name')
        .order('name');
      if (deptData) {
        setDepartments(deptData.map(dept => ({ id: dept.id.toString(), name: dept.name })));
      }
    };
    fetchDepartments();
  }, []);

  const handleFilterChange = (field: string, value: any) => {
    setFilters(prev => ({ ...prev, [field]: value }));
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('he-IL', {
      style: 'currency',
      currency: 'ILS',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const handleSearch = async () => {
    setLoading(true);
    setSearchPerformed(true);
    try {
      console.log('🔍 ContributionAll Report - Starting search with filters:', filters);

      // Step 1: Find all leads that have been through stage 60 (signed agreement)
      const fromDateTime = filters.fromDate ? `${filters.fromDate}T00:00:00` : null;
      const toDateTime = filters.toDate ? `${filters.toDate}T23:59:59` : null;

      let stageHistoryQuery = supabase
        .from('leads_leadstage')
        .select('id, stage, cdate, lead_id, newlead_id')
        .eq('stage', 60); // Stage 60 = signed agreement

      if (fromDateTime) {
        stageHistoryQuery = stageHistoryQuery.gte('cdate', fromDateTime);
      }
      if (toDateTime) {
        stageHistoryQuery = stageHistoryQuery.lte('cdate', toDateTime);
      }

      const { data: stageHistoryData, error: stageHistoryError } = await stageHistoryQuery;
      if (stageHistoryError) throw stageHistoryError;

      console.log('✅ ContributionAll Report - Found', stageHistoryData?.length || 0, 'leads with stage 60');

      // Separate new and legacy lead IDs
      const newLeadIds = new Set<string>();
      const legacyLeadIds = new Set<number>();

      stageHistoryData?.forEach((entry: any) => {
        if (entry.newlead_id) {
          newLeadIds.add(entry.newlead_id.toString());
        }
        if (entry.lead_id !== null && entry.lead_id !== undefined) {
          legacyLeadIds.add(Number(entry.lead_id));
        }
      });

      console.log('📊 ContributionAll Report - New leads:', newLeadIds.size, 'Legacy leads:', legacyLeadIds.size);

      // Step 2: Fetch new leads data
      const newLeadsMap = new Map();
      if (newLeadIds.size > 0) {
        const newLeadIdsArray = Array.from(newLeadIds);
        const { data: newLeads, error: newLeadsError } = await supabase
          .from('leads')
          .select(`
            id,
            lead_number,
            name,
            balance,
            balance_currency,
            proposal_total,
            proposal_currency,
            closer,
            manager,
            handler,
            case_handler_id,
            category_id,
            misc_category!category_id(
              id,
              name,
              parent_id,
              misc_maincategory!parent_id(
                id,
                name,
                department_id,
                tenant_departement!department_id(
                  id,
                  name
                )
              )
            )
          `)
          .in('id', newLeadIdsArray);

        if (newLeadsError) {
          console.error('❌ ContributionAll Report - Error fetching new leads:', newLeadsError);
        } else {
          newLeads?.forEach(lead => {
            newLeadsMap.set(lead.id, lead);
          });
          console.log('✅ ContributionAll Report - Fetched', newLeads?.length || 0, 'new leads');
        }
      }

      // Step 3: Fetch legacy leads data
      const legacyLeadsMap = new Map();
      if (legacyLeadIds.size > 0) {
        const legacyLeadIdsArray = Array.from(legacyLeadIds);
        const { data: legacyLeads, error: legacyLeadsError } = await supabase
          .from('leads_lead')
          .select(`
            id,
            name,
            total,
            currency_id,
            closer_id,
            meeting_manager_id,
            case_handler_id,
            category_id,
            accounting_currencies!leads_lead_currency_id_fkey(name, iso_code),
            misc_category!category_id(
              id,
              name,
              parent_id,
              misc_maincategory!parent_id(
                id,
                name,
                department_id,
                tenant_departement!department_id(
                  id,
                  name
                )
              )
            )
          `)
          .in('id', legacyLeadIdsArray);

        if (legacyLeadsError) {
          console.error('❌ ContributionAll Report - Error fetching legacy leads:', legacyLeadsError);
        } else {
          legacyLeads?.forEach(lead => {
            // Store with both number and string keys for compatibility
            const leadIdNum = Number(lead.id);
            const leadIdStr = lead.id.toString();
            legacyLeadsMap.set(leadIdNum, lead);
            if (leadIdNum.toString() !== leadIdStr) {
              legacyLeadsMap.set(leadIdStr, lead);
            }
          });
          console.log('✅ ContributionAll Report - Fetched', legacyLeads?.length || 0, 'legacy leads');
        }
      }

      // Step 4: Fetch payment plans for new leads - filter by due_date within date range (like Collection Due)
      const newPaymentsList: Array<{ leadId: string; amount: number }> = [];
      if (newLeadIds.size > 0) {
        const newLeadIdsArray = Array.from(newLeadIds);
        const fromDateTime = filters.fromDate ? `${filters.fromDate}T00:00:00` : null;
        const toDateTime = filters.toDate ? `${filters.toDate}T23:59:59` : null;

        let newPaymentsQuery = supabase
          .from('payment_plans')
          .select('lead_id, value, value_vat, currency, due_date')
          .in('lead_id', newLeadIdsArray)
          .eq('ready_to_pay', true)
          .eq('paid', false)
          .not('due_date', 'is', null)
          .is('cancel_date', null);

        if (fromDateTime) {
          newPaymentsQuery = newPaymentsQuery.gte('due_date', fromDateTime);
        }
        if (toDateTime) {
          newPaymentsQuery = newPaymentsQuery.lte('due_date', toDateTime);
        }

        const { data: newPayments, error: newPaymentsError } = await newPaymentsQuery;

        if (newPaymentsError) {
          console.error('❌ ContributionAll Report - Error fetching new payments:', newPaymentsError);
        } else {
          newPayments?.forEach(payment => {
            const value = Number(payment.value || 0);
            let vat = Number(payment.value_vat || 0);
            if (!vat && (payment.currency || '₪') === '₪') {
              vat = Math.round(value * 0.18 * 100) / 100;
            }
            const amount = value + vat;
            newPaymentsList.push({ leadId: payment.lead_id, amount });
          });
          console.log('✅ ContributionAll Report - Fetched payment plans for', newPayments?.length || 0, 'new leads');
        }
      }

      // Step 5: Fetch payment plans for legacy leads - filter by date and due_date within date range (like Collection Due)
      const legacyPaymentsList: Array<{ leadId: number; amount: number }> = [];
      if (legacyLeadIds.size > 0) {
        const legacyLeadIdsArray = Array.from(legacyLeadIds);
        const fromDateTime = filters.fromDate ? `${filters.fromDate}T00:00:00` : null;
        const toDateTime = filters.toDate ? `${filters.toDate}T23:59:59` : null;

        let legacyPaymentsQuery = supabase
          .from('finances_paymentplanrow')
          .select('lead_id, value_base, vat_value, currency_id, due_date, date, accounting_currencies!finances_paymentplanrow_currency_id_fkey(name, iso_code)')
          .in('lead_id', legacyLeadIdsArray)
          .not('due_date', 'is', null)
          .is('cancel_date', null);

        // Filter by 'date' column within date range
        if (fromDateTime) {
          legacyPaymentsQuery = legacyPaymentsQuery.gte('date', fromDateTime);
        }
        if (toDateTime) {
          legacyPaymentsQuery = legacyPaymentsQuery.lte('date', toDateTime);
        }

        // Also filter by due_date to match the date range
        if (fromDateTime) {
          legacyPaymentsQuery = legacyPaymentsQuery.gte('due_date', fromDateTime);
        }
        if (toDateTime) {
          legacyPaymentsQuery = legacyPaymentsQuery.lte('due_date', toDateTime);
        }

        const { data: legacyPayments, error: legacyPaymentsError } = await legacyPaymentsQuery;

        if (legacyPaymentsError) {
          console.error('❌ ContributionAll Report - Error fetching legacy payments:', legacyPaymentsError);
        } else {
          legacyPayments?.forEach((payment: any) => {
            const value = Number(payment.value_base || 0);
            let vat = Number(payment.vat_value || 0);
            
            const accountingCurrency: any = payment.accounting_currencies 
              ? (Array.isArray(payment.accounting_currencies) ? payment.accounting_currencies[0] : payment.accounting_currencies) 
              : null;
            
            const currency = accountingCurrency?.name || accountingCurrency?.iso_code ||
              (payment.currency_id === 2 ? '€' : 
               payment.currency_id === 3 ? '$' : 
               payment.currency_id === 4 ? '£' : '₪');
            
            if (!vat && (currency === '₪' || currency === 'ILS')) {
              vat = Math.round(value * 0.18 * 100) / 100;
            }
            const amount = value + vat;
            legacyPaymentsList.push({ leadId: Number(payment.lead_id), amount });
          });
          console.log('✅ ContributionAll Report - Fetched payment plans for', legacyPayments?.length || 0, 'legacy leads');
        }
      }

      // Step 6: Fetch employee information
      const employeeMap = new Map<number, string>();
      const allEmployeeIds = new Set<number>();

      // Collect employee IDs from new leads (closer and manager for signed, case_handler for payments)
      newLeadsMap.forEach((lead: any) => {
        if (lead.closer) {
          allEmployeeIds.add(Number(lead.closer));
        }
        if (lead.manager) {
          allEmployeeIds.add(Number(lead.manager));
        }
        if (lead.case_handler_id) {
          allEmployeeIds.add(Number(lead.case_handler_id));
        }
      });

      // Collect employee IDs from legacy leads (closer_id and meeting_manager_id for signed, case_handler_id for payments)
      legacyLeadsMap.forEach((lead: any) => {
        if (lead.closer_id !== null && lead.closer_id !== undefined) {
          allEmployeeIds.add(Number(lead.closer_id));
        }
        if (lead.meeting_manager_id !== null && lead.meeting_manager_id !== undefined) {
          allEmployeeIds.add(Number(lead.meeting_manager_id));
        }
        if (lead.case_handler_id) {
          allEmployeeIds.add(Number(lead.case_handler_id));
        }
      });

      if (allEmployeeIds.size > 0) {
        const employeeIdsArray = Array.from(allEmployeeIds);
        const { data: employeeData, error: employeeError } = await supabase
          .from('tenants_employee')
          .select('id, display_name, department_id, tenant_departement!department_id(id, name)')
          .in('id', employeeIdsArray);

        if (employeeError) {
          console.error('❌ ContributionAll Report - Error fetching employees:', employeeError);
        } else {
          employeeData?.forEach(emp => {
            employeeMap.set(Number(emp.id), emp.display_name || `Employee #${emp.id}`);
          });
          console.log('✅ ContributionAll Report - Fetched', employeeData?.length || 0, 'employees');
        }
      }

      // Step 7: Process data and group by department and employee
      const departmentEmployeeMap = new Map<string, Map<number, { 
        employeeName: string; 
        signed: number; 
        signedPortion: number;
        due: number;
        duePortion: number;
        hExpert: number;
        expertPortion: number;
        total: number;
        totalPortion: number;
        percentOfIncome: number;
        normalized: number;
      }>>();

      // Helper function to initialize employee data in the map
      const initializeEmployee = (deptName: string, empId: number, empName: string) => {
        if (!departmentEmployeeMap.has(deptName)) {
          departmentEmployeeMap.set(deptName, new Map());
        }
        const employeeMapForDept = departmentEmployeeMap.get(deptName)!;
        if (!employeeMapForDept.has(empId)) {
          employeeMapForDept.set(empId, { 
            employeeName: empName, 
            signed: 0, 
            signedPortion: 0,
            due: 0,
            duePortion: 0,
            hExpert: 0,
            expertPortion: 0,
            total: 0,
            totalPortion: 0,
            percentOfIncome: 0,
            normalized: 0
          });
        }
        return employeeMapForDept.get(empId)!;
      };

      // Process new leads - calculate signed amounts (using closer and manager, not handler)
      newLeadsMap.forEach((lead: any, leadId: string) => {
        const category = lead.misc_category;
        const mainCategory = category ? (Array.isArray(category.misc_maincategory) ? category.misc_maincategory[0] : category.misc_maincategory) : null;
        const department = mainCategory?.tenant_departement ? (Array.isArray(mainCategory.tenant_departement) ? mainCategory.tenant_departement[0] : mainCategory.tenant_departement) : null;
        const departmentName = department?.name || 'Unassigned';

        // Signed = value of lead (balance || proposal_total, like SignedSalesReportPage)
        const balanceAmount = Number(lead.balance || 0);
        const proposalAmount = Number(lead.proposal_total || 0);
        const signedValue = balanceAmount || proposalAmount || 0;

        // Attribute to closer if exists
        if (lead.closer) {
          const closerId = Number(lead.closer);
          if (closerId) {
            const closerName = employeeMap.get(closerId) || 'Unknown';
            const closerData = initializeEmployee(departmentName, closerId, closerName);
            closerData.signed += signedValue;
          }
        }

        // Attribute to manager if exists
        if (lead.manager) {
          const managerId = Number(lead.manager);
          if (managerId) {
            const managerName = employeeMap.get(managerId) || 'Unknown';
            const managerData = initializeEmployee(departmentName, managerId, managerName);
            managerData.signed += signedValue;
          }
        }
      });

      // Process new payments - calculate due amounts (like Collection Due)
      newPaymentsList.forEach(payment => {
        const lead = newLeadsMap.get(payment.leadId);
        if (!lead) return;

        const category = lead.misc_category;
        const mainCategory = category ? (Array.isArray(category.misc_maincategory) ? category.misc_maincategory[0] : category.misc_maincategory) : null;
        const department = mainCategory?.tenant_departement ? (Array.isArray(mainCategory.tenant_departement) ? mainCategory.tenant_departement[0] : mainCategory.tenant_departement) : null;
        const departmentName = department?.name || 'Unassigned';

        const employeeId = lead.case_handler_id ? Number(lead.case_handler_id) : null;
        if (!employeeId) return;

        const employeeName = employeeMap.get(employeeId) || 'Unknown';
        const employeeData = initializeEmployee(departmentName, employeeId, employeeName);
        
        // Add payment amount to due (process each payment individually like Collection Due)
        employeeData.due += payment.amount;
      });

      // Process legacy leads - calculate signed amounts (using closer_id and meeting_manager_id, not case_handler_id)
      legacyLeadsMap.forEach((lead: any, leadId: number) => {
        const category = lead.misc_category;
        const mainCategory = category ? (Array.isArray(category.misc_maincategory) ? category.misc_maincategory[0] : category.misc_maincategory) : null;
        const department = mainCategory?.tenant_departement ? (Array.isArray(mainCategory.tenant_departement) ? mainCategory.tenant_departement[0] : mainCategory.tenant_departement) : null;
        const departmentName = department?.name || 'Unassigned';

        // Signed = value of lead (total for legacy leads, like SignedSalesReportPage)
        const signedValue = Number(lead.total || 0);

        // Attribute to closer if exists
        if (lead.closer_id !== null && lead.closer_id !== undefined) {
          const closerId = Number(lead.closer_id);
          if (closerId) {
            const closerName = employeeMap.get(closerId) || 'Unknown';
            const closerData = initializeEmployee(departmentName, closerId, closerName);
            closerData.signed += signedValue;
          }
        }

        // Attribute to manager if exists
        if (lead.meeting_manager_id !== null && lead.meeting_manager_id !== undefined) {
          const managerId = Number(lead.meeting_manager_id);
          if (managerId) {
            const managerName = employeeMap.get(managerId) || 'Unknown';
            const managerData = initializeEmployee(departmentName, managerId, managerName);
            managerData.signed += signedValue;
          }
        }
      });

      // Process legacy payments - calculate due amounts (like Collection Due)
      legacyPaymentsList.forEach(payment => {
        // Try both number and string keys for lookup
        const leadIdKey = payment.leadId.toString();
        const lead = legacyLeadsMap.get(payment.leadId) || legacyLeadsMap.get(leadIdKey);
        if (!lead) return;

        const category = lead.misc_category;
        const mainCategory = category ? (Array.isArray(category.misc_maincategory) ? category.misc_maincategory[0] : category.misc_maincategory) : null;
        const department = mainCategory?.tenant_departement ? (Array.isArray(mainCategory.tenant_departement) ? mainCategory.tenant_departement[0] : mainCategory.tenant_departement) : null;
        const departmentName = department?.name || 'Unassigned';

        const employeeId = lead.case_handler_id ? Number(lead.case_handler_id) : null;
        if (!employeeId) return;

        const employeeName = employeeMap.get(employeeId) || 'Unknown';
        const employeeData = initializeEmployee(departmentName, employeeId, employeeName);
        
        // Add payment amount to due (process each payment individually like Collection Due)
        employeeData.due += payment.amount;
      });

      // Calculate total for each employee
      departmentEmployeeMap.forEach((employeeMap) => {
        employeeMap.forEach((employeeData) => {
          employeeData.total = employeeData.signed + employeeData.due;
        });
      });

      // Step 8: Fetch supervisors (employees with bonuses_role = 'dm')
      const supervisorMap = new Map<string, { id: number; name: string }>(); // department_id -> supervisor
      const { data: supervisorsData, error: supervisorsError } = await supabase
        .from('tenants_employee')
        .select('id, display_name, department_id')
        .eq('bonuses_role', 'dm');

      if (supervisorsError) {
        console.error('❌ ContributionAll Report - Error fetching supervisors:', supervisorsError);
      } else {
        supervisorsData?.forEach(supervisor => {
          if (supervisor.department_id) {
            const deptId = supervisor.department_id.toString();
            supervisorMap.set(deptId, {
              id: supervisor.id,
              name: supervisor.display_name || `Employee #${supervisor.id}`
            });
          }
        });
        console.log('✅ ContributionAll Report - Fetched', supervisorsData?.length || 0, 'supervisors');
      }

      // Step 9: Fetch department IDs to match supervisors
      const departmentNameToIdMap = new Map<string, string>();
      const { data: allDepartments, error: deptError } = await supabase
        .from('tenant_departement')
        .select('id, name');

      if (!deptError && allDepartments) {
        allDepartments.forEach(dept => {
          departmentNameToIdMap.set(dept.name, dept.id.toString());
        });
      }

      // Step 10: Convert to array format for display with supervisor info
      const departmentDataMap = new Map<string, { employees: any[]; supervisor: { id: number; name: string } | null }>();
      departmentEmployeeMap.forEach((employeeMap, deptName) => {
        const employees = Array.from(employeeMap.values()).sort((a, b) => a.employeeName.localeCompare(b.employeeName));
        const deptId = departmentNameToIdMap.get(deptName);
        const supervisor = deptId ? supervisorMap.get(deptId) || null : null;
        departmentDataMap.set(deptName, { employees, supervisor });
      });

      setDepartmentData(departmentDataMap);
      console.log('✅ ContributionAll Report - Processed data for', departmentDataMap.size, 'departments');
    } catch (error) {
      console.error('Error fetching contribution data:', error);
      toast.error('Failed to fetch contribution data.');
      setDepartmentData(new Map<string, { employees: any[]; supervisor: { id: number; name: string } | null }>());
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      {/* Filters */}
      <div className="bg-white mb-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          <div className="form-control">
            <label className="label mb-2"><span className="label-text">From date:</span></label>
            <input
              type="date"
              className="input input-bordered"
              value={filters.fromDate}
              onChange={e => handleFilterChange('fromDate', e.target.value)}
            />
          </div>
          <div className="form-control">
            <label className="label mb-2"><span className="label-text">To date:</span></label>
            <input
              type="date"
              className="input input-bordered"
              value={filters.toDate}
              onChange={e => handleFilterChange('toDate', e.target.value)}
            />
          </div>
          <div className="form-control">
            <button
              className="btn btn-primary w-full"
              onClick={handleSearch}
              disabled={loading}
            >
              {loading ? 'Loading...' : 'Calc'}
            </button>
          </div>
        </div>
      </div>

      {/* Results */}
      {searchPerformed && (
        <div>
          {loading ? (
            <div className="flex justify-center p-8">
              <span className="loading loading-spinner loading-lg"></span>
            </div>
          ) : departmentData.size > 0 ? (
            <div className="space-y-8">
              {Array.from(departmentData.entries()).map(([deptName, deptData]) => (
                <div key={deptName} className="-mx-4 sm:-mx-6 md:mx-0">
                  <div className="px-4 sm:px-6 md:px-0">
                    <h3 className="text-xl font-bold mb-4">{deptName}</h3>
                    <div className="overflow-x-auto">
                      <table className="table w-full text-xs sm:text-sm">
                        <thead>
                          <tr className="bg-white">
                            <th className="text-left text-xs sm:text-sm">Employee</th>
                            <th className="text-right text-xs sm:text-sm">Signed</th>
                            <th className="text-right text-xs sm:text-sm bg-gray-100">Signed Portion</th>
                            <th className="text-right text-xs sm:text-sm">Due</th>
                            <th className="text-right text-xs sm:text-sm bg-gray-100">Due Portion</th>
                            <th className="text-right text-xs sm:text-sm">H. Expert</th>
                            <th className="text-right text-xs sm:text-sm bg-gray-100">Expert Portion</th>
                            <th className="text-right text-xs sm:text-sm">Total</th>
                            <th className="text-right text-xs sm:text-sm bg-gray-100">Total Portion</th>
                            <th className="text-right text-xs sm:text-sm">% of income</th>
                            <th className="text-right text-xs sm:text-sm">Normalized</th>
                          </tr>
                        </thead>
                        <tbody>
                          {deptData.employees.map((emp, index) => (
                            <tr key={index}>
                              <td className="text-left font-medium text-xs sm:text-sm">{emp.employeeName}</td>
                              <td className="text-right text-xs sm:text-sm">{formatCurrency(emp.signed)}</td>
                              <td className="text-right text-xs sm:text-sm bg-gray-50">{formatCurrency(emp.signedPortion)}</td>
                              <td className="text-right text-xs sm:text-sm">{formatCurrency(emp.due)}</td>
                              <td className="text-right text-xs sm:text-sm bg-gray-50">{formatCurrency(emp.duePortion)}</td>
                              <td className="text-right text-xs sm:text-sm">{formatCurrency(emp.hExpert)}</td>
                              <td className="text-right text-xs sm:text-sm bg-gray-50">{formatCurrency(emp.expertPortion)}</td>
                              <td className="text-right text-xs sm:text-sm">{formatCurrency(emp.total)}</td>
                              <td className="text-right text-xs sm:text-sm bg-gray-50">{formatCurrency(emp.totalPortion)}</td>
                              <td className="text-right text-xs sm:text-sm">{emp.percentOfIncome}%</td>
                              <td className="text-right text-xs sm:text-sm">{emp.normalized}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {/* Supervisor Information */}
                    <div className="mt-4 flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        {deptData.supervisor ? (
                          <>
                            <span className="font-bold text-sm">Supervisor: {deptData.supervisor.name}</span>
                            <span className="text-sm">Credit as supervisor: {formatCurrency(0)}</span>
                          </>
                        ) : (
                          <span className="text-sm text-gray-500">The department has no supervisor</span>
                        )}
                      </div>
                      {deptData.supervisor && (
                        <button className="btn btn-success text-white">
                          Total: {formatCurrency(0)}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center p-8 bg-base-200 rounded-lg">
              No data found for the selected date range.
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const AllContributionReport = ContributionAllReport;

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
      { label: 'Super Pipeline', icon: BanknotesIcon, component: SchedulerSuperPipelineReport },
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
    category: 'Contribution',
    items: [
      { label: 'All', icon: RectangleStackIcon, component: AllContributionReport },
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
      { label: 'Collection', icon: BanknotesIcon, route: '/reports/collection-finances' },
      { label: 'Collection Due', icon: BanknotesIcon, component: CollectionDueReport },
    ],
  },
  {
    category: 'Cases',
    items: [
      { label: 'Sum Active', icon: BriefcaseIcon, component: SumActiveReport },
    ],
  },
  {
    category: 'Tools',
    items: [
      { label: 'Edit Contracts', icon: DocumentTextIcon, component: EditContractsReport },
    ],
  },
];

export default function ReportsPage() {
  const navigate = useNavigate();
  const [selectedReport, setSelectedReport] = useState<ReportItem | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showSearchDropdown, setShowSearchDropdown] = useState<boolean>(false);
  const [isSuperUser, setIsSuperUser] = useState<boolean>(false);

  console.log('Selected report:', selectedReport);

  // Fetch superuser status
  useEffect(() => {
    const fetchSuperUserStatus = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data: userData, error: userError } = await supabase
            .from('users')
            .select('is_superuser')
            .eq('auth_id', user.id)
            .single();

          // If not found by auth_id, try by email
          if ((userError || !userData) && user.email) {
            const { data: userByEmail } = await supabase
              .from('users')
              .select('is_superuser')
              .eq('email', user.email)
              .maybeSingle();
            
            if (userByEmail) {
              setIsSuperUser(userByEmail.is_superuser === true || userByEmail.is_superuser === 'true' || userByEmail.is_superuser === 1);
            }
          } else if (userData) {
            setIsSuperUser(userData.is_superuser === true || userData.is_superuser === 'true' || userData.is_superuser === 1);
          }
        }
      } catch (error) {
        console.error('Error fetching superuser status:', error);
      }
    };

    fetchSuperUserStatus();
  }, []);

  // Close dropdown when report is selected
  useEffect(() => {
    if (selectedReport) {
      setShowSearchDropdown(false);
      setSearchQuery('');
    }
  }, [selectedReport]);

  // Filter reports based on search query and superuser status
  const filteredReports = useMemo(() => {
    // First filter by superuser status
    let reportsToFilter = reports;
    if (!isSuperUser) {
      reportsToFilter = reports.filter(section => section.category !== 'Tools');
    }

    // Then filter by search query
    if (!searchQuery.trim()) {
      return reportsToFilter;
    }

    const query = searchQuery.toLowerCase().trim();
    return reportsToFilter
      .map((section) => {
        const filteredItems = section.items.filter((item) => {
          const matchesLabel = item.label.toLowerCase().includes(query);
          const matchesCategory = section.category.toLowerCase().includes(query);
          return matchesLabel || matchesCategory;
        });

        return {
          ...section,
          items: filteredItems,
        };
      })
      .filter((section) => section.items.length > 0);
  }, [searchQuery, isSuperUser]);

  return (
    <div className="p-0 md:p-6 space-y-8">
      {!selectedReport ? (
        <>
          <div className="px-4 md:px-0">
            <h1 className="text-4xl font-bold mb-6">Reports</h1>
            {/* Search Bar */}
            <div className="mb-8">
              <div className="relative max-w-2xl">
                <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search reports by name or category..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-10 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    <XMarkIcon className="w-5 h-5" />
                  </button>
                )}
              </div>
              {searchQuery && (
                <p className="mt-2 text-sm text-gray-600">
                  Found {filteredReports.reduce((sum, section) => sum + section.items.length, 0)} report(s)
                </p>
              )}
            </div>
          </div>
          <div className="space-y-6 sm:space-y-8 md:space-y-10 px-4 md:px-0">
            {filteredReports.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-gray-500 text-lg">No reports found matching "{searchQuery}"</p>
                <button
                  onClick={() => setSearchQuery('')}
                  className="mt-4 text-primary hover:underline"
                >
                  Clear search
                </button>
              </div>
            ) : (
              filteredReports.map((section) => (
              <div key={section.category}>
                <h2 className="text-2xl font-semibold mb-4">{section.category}</h2>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 sm:gap-3 md:gap-4 lg:gap-6">
                  {section.items.map((item) => (
                    <button
                      key={item.label}
                        className="card bg-base-100 shadow hover:shadow-lg transition-shadow border border-base-200 flex flex-col items-center justify-center p-3 sm:p-4 md:p-5 lg:p-6 cursor-pointer hover:bg-primary hover:text-white group"
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
                        <item.icon className="w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 mb-2 sm:mb-2 md:mb-3 text-black group-hover:text-white" />
                        <span className="font-semibold text-sm sm:text-base md:text-lg text-center group-hover:text-white">{item.label}</span>
                    </button>
                  ))}
                </div>
              </div>
              ))
            )}
          </div>
        </>
      ) : (
        <div className="px-4 md:px-0">
          {/* Report Content */}
          <div className="bg-white rounded-xl shadow-lg p-8 border border-base-200">
            <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
              <h3 className="text-2xl font-bold">{selectedReport.label}</h3>
              <div className="flex items-center gap-3 flex-wrap">
                {/* Search Bar in Report View */}
                <div className="relative max-w-xs">
                  <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search other reports..."
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setShowSearchDropdown(e.target.value.length > 0);
                    }}
                    onFocus={() => {
                      if (searchQuery.length > 0) {
                        setShowSearchDropdown(true);
                      }
                    }}
                    onBlur={() => {
                      // Delay closing to allow click events to fire
                      setTimeout(() => setShowSearchDropdown(false), 200);
                    }}
                    className="w-full pl-10 pr-10 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent text-sm"
                  />
                  {searchQuery && (
              <button
                      onClick={() => {
                        setSearchQuery('');
                        setShowSearchDropdown(false);
                      }}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      <XMarkIcon className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <button
                  onClick={() => {
                    setSelectedReport(null);
                    setSearchQuery('');
                  }}
                className="btn btn-outline btn-primary flex items-center gap-2"
              >
                <ArrowLeftIcon className="w-5 h-5" />
                Back to Reports
              </button>
            </div>
            </div>
            
            {/* Search Results Dropdown */}
            {showSearchDropdown && searchQuery && (
              <div className="mb-6 border border-gray-200 rounded-lg bg-white shadow-lg max-h-96 overflow-y-auto z-50">
                <div className="p-4">
                  <p className="text-sm font-semibold text-gray-700 mb-3">Quick Switch to:</p>
                  <div className="space-y-2">
                    {filteredReports.map((section) =>
                      section.items.map((item) => (
                        <button
                          key={item.label}
                          onClick={() => {
                            setShowSearchDropdown(false);
                            if (item.route) {
                              navigate(item.route);
                              setSearchQuery('');
                              return;
                            }
                            if (item.component) {
                              setSelectedReport(item);
                              setSearchQuery('');
                            }
                          }}
                          className={`w-full text-left px-4 py-2 rounded-md hover:bg-primary hover:text-white transition-colors flex items-center gap-3 ${
                            selectedReport?.label === item.label ? 'bg-primary text-white' : 'bg-gray-50'
                          }`}
                        >
                          <item.icon className="w-5 h-5" />
                          <div className="flex-1">
                            <div className="font-medium">{item.label}</div>
                            <div className="text-xs opacity-75">{section.category}</div>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                  {filteredReports.length === 0 && (
                    <div className="text-center py-4 text-gray-500 text-sm">
                      No reports found matching "{searchQuery}"
                    </div>
                  )}
                </div>
              </div>
            )}
            
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