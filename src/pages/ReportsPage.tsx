import React, { useMemo, useState, useEffect, useRef } from 'react';
import { MagnifyingGlassIcon, Squares2X2Icon, ArrowUturnDownIcon, DocumentDuplicateIcon, ChartPieIcon, AdjustmentsHorizontalIcon, FunnelIcon, ClockIcon, ArrowPathIcon, CheckCircleIcon, BanknotesIcon, UserGroupIcon, UserIcon, AcademicCapIcon, StarIcon, PlusIcon, ClipboardDocumentCheckIcon, ChartBarIcon, ListBulletIcon, CurrencyDollarIcon, BriefcaseIcon, ArrowLeftIcon, InformationCircleIcon, RectangleStackIcon, DocumentTextIcon } from '@heroicons/react/24/solid';
import { XMarkIcon, ArrowDownTrayIcon, ScaleIcon, GlobeAltIcon, HomeIcon, ShieldCheckIcon, UsersIcon, WrenchScrewdriverIcon, ClipboardDocumentListIcon, ExclamationTriangleIcon, BuildingOfficeIcon, HeartIcon, CogIcon, CalendarIcon, CurrencyDollarIcon as CurrencyDollarIconOutline } from '@heroicons/react/24/outline';
import * as XLSX from 'xlsx';
import { toast } from 'react-hot-toast';
import FullSearchReport from './FullSearchReport';
import { supabase } from '../lib/supabase';
import EmployeeLeadDrawer, {
  EmployeeLeadDrawerItem,
  LeadBaseDetail,
} from '../components/reports/EmployeeLeadDrawer';
import { useNavigate, Link } from 'react-router-dom';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend, Cell } from 'recharts';
import { convertToNIS } from '../lib/currencyConversion';
import { usePersistedFilters } from '../hooks/usePersistedState';

// Add a helper for currency symbol
const getCurrencySymbol = (currency?: string) => {
  switch (currency) {
    case 'USD': return '$';
    case 'EUR': return '€';
    case 'NIS':
    default: return '₪';
  }
};

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
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-base-content/50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
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
                <feDropShadow dx="2" dy="4" stdDeviation="3" floodOpacity="0.3" />
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
              className={`flex items-center gap-3 p-2 rounded-lg transition-all duration-200 cursor-pointer ${hoveredIndex === index ? 'bg-gray-100 shadow-md transform scale-105' : 'hover:bg-gray-50'
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
        className={`w-full text-center font-semibold focus:outline-none ${disabled
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
      let query = supabase.from('leads').select(`
        *,
        accounting_currencies!leads_currency_id_fkey (
          id,
          name,
          iso_code
        )
      `);

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

      // Process currency data from joined table (same as CalendarPage.tsx)
      const processedData = (data || []).map((lead: any) => {
        // Extract currency data from joined table
        const currencyRecord = lead.accounting_currencies
          ? (Array.isArray(lead.accounting_currencies) ? lead.accounting_currencies[0] : lead.accounting_currencies)
          : null;

        // Convert currency_id to symbol (same logic as CalendarPage.tsx)
        if (currencyRecord) {
          // Convert iso_code to symbol
          const currencySymbol = (() => {
            if (currencyRecord.iso_code) {
              const isoCode = currencyRecord.iso_code.toUpperCase();
              if (isoCode === 'ILS' || isoCode === 'NIS') return '₪';
              if (isoCode === 'USD') return '$';
              if (isoCode === 'EUR') return '€';
              if (isoCode === 'GBP') return '£';
              if (isoCode === 'CAD') return 'C$';
              if (isoCode === 'AUD') return 'A$';
              if (isoCode === 'JPY') return '¥';
              return currencyRecord.name || isoCode || '₪';
            }
            // Fallback: if we have currency_id but no joined data, use simple mapping
            if (lead.currency_id) {
              const currencyId = Number(lead.currency_id);
              switch (currencyId) {
                case 1: return '₪'; break; // ILS
                case 2: return '€'; break; // EUR
                case 3: return '$'; break; // USD
                case 4: return '£'; break; // GBP
                default: return '₪';
              }
            }
            return '₪';
          })();
          // Set balance_currency to the symbol (same as CalendarPage.tsx)
          lead.balance_currency = currencySymbol;
        } else if (lead.currency_id) {
          // If no joined currency data but we have currency_id, use fallback mapping
          const currencyId = Number(lead.currency_id);
          switch (currencyId) {
            case 1: lead.balance_currency = '₪'; break;
            case 2: lead.balance_currency = '€'; break;
            case 3: lead.balance_currency = '$'; break;
            case 4: lead.balance_currency = '£'; break;
            default: lead.balance_currency = '₪';
          }
        } else {
          // Default to NIS if no currency_id
          lead.balance_currency = lead.balance_currency || '₪';
        }

        return lead;
      });

      // Calculate results with bonus information
      const processedResults = processedData.map(lead => {
        const leadValue = lead.balance || 0;
        // Convert to NIS using proper conversion rates
        let leadValueInNIS = leadValue;
        const currency = lead.balance_currency || '₪';
        if (currency === '$' || currency === 'USD') {
          leadValueInNIS = leadValue * 3.7;
        } else if (currency === '€' || currency === 'EUR') {
          leadValueInNIS = leadValue * 4.0;
        } else if (currency === '£' || currency === 'GBP') {
          leadValueInNIS = leadValue * 4.7;
        }

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
                          {(() => {
                            // Same logic as CalendarPage.tsx balance badge
                            const isLegacy = lead.lead_type === 'legacy' || lead.id?.toString().startsWith('legacy_');
                            let balanceValue: any;

                            if (isLegacy) {
                              // For legacy leads: if currency_id is 1 (NIS/ILS), use total_base; otherwise use total
                              const currencyId = (lead as any).currency_id;
                              let numericCurrencyId = typeof currencyId === 'string' ? parseInt(currencyId, 10) : Number(currencyId);
                              if (!numericCurrencyId || isNaN(numericCurrencyId)) {
                                numericCurrencyId = 1; // Default to NIS
                              }
                              if (numericCurrencyId === 1) {
                                balanceValue = (lead as any).total_base ?? null;
                              } else {
                                balanceValue = (lead as any).total ?? null;
                              }
                            } else {
                              balanceValue = lead.balance || (lead as any).proposal_total;
                            }

                            // Get currency symbol - balance_currency should already be set from joined data
                            // But handle fallback if not set
                            let balanceCurrency = lead.balance_currency;
                            if (!balanceCurrency) {
                              const currencyId = (lead as any).currency_id;
                              if (currencyId) {
                                const numericCurrencyId = typeof currencyId === 'string' ? parseInt(currencyId, 10) : Number(currencyId);
                                // Fallback to hardcoded mapping if currency not found in map
                                balanceCurrency = numericCurrencyId === 1 ? 'NIS' :
                                  numericCurrencyId === 2 ? 'USD' :
                                    numericCurrencyId === 3 ? 'EUR' :
                                      numericCurrencyId === 4 ? 'GBP' : 'NIS';
                              } else {
                                balanceCurrency = 'NIS';
                              }
                            }

                            // Convert currency symbol to code for getCurrencySymbol function
                            // getCurrencySymbol expects codes like 'USD', 'EUR', 'NIS', not symbols
                            if (balanceCurrency === '₪') balanceCurrency = 'NIS';
                            else if (balanceCurrency === '$') balanceCurrency = 'USD';
                            else if (balanceCurrency === '€') balanceCurrency = 'EUR';
                            else if (balanceCurrency === '£') balanceCurrency = 'GBP';

                            if (balanceValue === '--') {
                              return '--';
                            }

                            // Ensure we have a currency (default to NIS)
                            if (!balanceCurrency) {
                              balanceCurrency = 'NIS';
                            }

                            // Handle 0 values - show currency symbol
                            if (balanceValue === 0 || balanceValue === '0' || Number(balanceValue) === 0) {
                              return `${getCurrencySymbol(balanceCurrency)}0`;
                            }

                            if (balanceValue && (Number(balanceValue) > 0 || balanceValue !== '0')) {
                              const formattedValue = typeof balanceValue === 'number'
                                ? balanceValue.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
                                : Number(balanceValue).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
                              return `${getCurrencySymbol(balanceCurrency)}${formattedValue}`;
                            }

                            // Default: show 0 with NIS symbol
                            return `${getCurrencySymbol(balanceCurrency)}0`;
                          })()}
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
      const allowedStageIds = ['10', '11', '15', '20', '21', '30', '40'];

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
      const allowedLegacyStageIds = [10, 11, 15, 20, 21, 30, 40];

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
  // {
  //   category: 'Search',
  //   items: [
  //     { label: 'Full Search', icon: MagnifyingGlassIcon, component: FullSearchReport },
  //     { label: 'Stage Search', icon: Squares2X2Icon, component: StageSearchReport },
  //     { label: 'Anchor Search', icon: ArrowUturnDownIcon, component: AnchorSearchReport },
  //     { label: 'Duplicate Search', icon: DocumentDuplicateIcon, component: DuplicateSearchReport },
  //   ],
  // },
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
      // { label: 'Rescheduled', icon: ArrowPathIcon, component: RescheduledReport },
      // { label: 'Results', icon: CheckCircleIcon, component: ResultsReport },
      // { label: 'Collection', icon: BanknotesIcon, component: CollectionReport },
      // { label: 'Convertion', icon: FunnelIcon, component: ConvertionReport },
    ],
  },
  {
    category: 'Sales',
    items: [
      // { label: 'Actual', icon: UserGroupIcon, component: ActualReport },
      // { label: 'Target', icon: UserIcon, component: TargetReport },
      { label: 'Signed', icon: AcademicCapIcon, route: '/sales/signed' },
      // { label: 'Scheduling Bonuses', icon: StarIcon, component: SchedulingBonusesReport },
      { label: 'Bonuses (v4)', icon: PlusIcon, component: BonusesV4Report },
    ],
  },
  {
    category: 'Pipelines',
    items: [
      // { label: 'General Sales', icon: Squares2X2Icon, component: GeneralSalesReport },
      // { label: 'Employee', icon: UserIcon, component: EmployeeReport },
      // { label: 'Unhandled', icon: UserIcon, component: UnhandledReport },
      { label: 'Expert', icon: AcademicCapIcon, component: ExpertReport },
      { label: 'Sales Pipeline', icon: BanknotesIcon, route: '/reports/closer-super-pipeline' },
    ],
  },
  // {
  //   category: 'Schedulers',
  //   items: [
  //     { label: 'Super Pipeline', icon: BanknotesIcon, component: SchedulerSuperPipelineReport },
  //     // { label: 'Schedulers Quality', icon: StarIcon, component: SchedulersQualityReport },
  //     // { label: 'Performance', icon: ChartBarIcon, component: PerformanceReport },
  //     // { label: 'Performance by Cat.', icon: ChartBarIcon, component: PerformanceByCatReport },
  //   ],
  // },
  // {
  //   category: 'Closers',
  //   items: [
  //     { label: 'Super Pipeline', icon: BanknotesIcon, route: '/reports/closer-super-pipeline' },
  //     // { label: 'Closers Quality', icon: StarIcon, component: ClosersQualityReport },
  //   ],
  // },
  {
    category: 'Experts',
    items: [
      // { label: 'Experts Assignment', icon: AcademicCapIcon, component: ExpertsAssignmentReport },
      { label: 'Experts Results', icon: AcademicCapIcon, component: ExpertsResultsReport },
    ],
  },
  {
    category: 'Contribution',
    items: [
      { label: 'All', icon: RectangleStackIcon, component: AllContributionReport },
      { label: 'Sales Contribution', icon: ChartBarIcon, route: '/reports/sales-contribution' },
    ],
  },
  // {
  //   category: 'Analysis',
  //   items: [
  //     // { label: 'Employees Performance', icon: ChartBarIcon, component: EmployeesPerformanceReport },
  //     // { label: 'Statistics', icon: ChartPieIcon, component: StatisticsReport },
  //     // { label: 'Pies', icon: ChartPieIcon, component: PiesReport },
  //     // { label: 'Tasks', icon: ListBulletIcon, component: TasksReport },
  //   ],
  // },
  {
    category: 'Finances',
    items: [
      // { label: 'Profitability', icon: CurrencyDollarIcon, component: ProfitabilityReport },
      { label: 'Collection', icon: BanknotesIcon, route: '/reports/collection-finances' },
      { label: 'Collection Due', icon: BanknotesIcon, route: '/reports/collection-due' },
    ],
  },
  // {
  //   category: 'Cases',
  //   items: [
  //     // { label: 'Sum Active', icon: BriefcaseIcon, component: SumActiveReport },
  //   ],
  // },
  {
    category: 'Tools',
    items: [
      { label: 'Edit Contracts', icon: DocumentTextIcon, route: '/reports/edit-contracts' },
      { label: 'Re-assign leads', icon: ArrowPathIcon, route: '/reports/reassign-leads' },
      { label: 'Employee Unavailabilities', icon: CalendarIcon, route: '/reports/employee-unavailabilities' },
      { label: 'Employee Salaries', icon: CurrencyDollarIconOutline, route: '/reports/employee-salaries' },
    ],
  },
  {
    category: 'Employees',
    items: [
      { label: 'Employee Info', icon: UserGroupIcon, route: '/reports/employee-info' },
    ],
  },
];

export default function ReportsPage() {
  const navigate = useNavigate();
  const [selectedReport, setSelectedReport] = useState<ReportItem | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showSearchDropdown, setShowSearchDropdown] = useState<boolean>(false);
  const [isSuperUser, setIsSuperUser] = useState<boolean>(false);
  const [hasCollectionAccess, setHasCollectionAccess] = useState<boolean>(false);

  console.log('Selected report:', selectedReport);

  // Fetch superuser status and collection access
  useEffect(() => {
    const fetchUserPermissions = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          // Try to find user by auth_id first
          let { data: userData, error: userError } = await supabase
            .from('users')
            .select('is_superuser, employee_id')
            .eq('auth_id', user.id)
            .maybeSingle();

          // If not found by auth_id, try by email
          if ((userError || !userData) && user.email) {
            const { data: userByEmail } = await supabase
              .from('users')
              .select('is_superuser, employee_id')
              .eq('email', user.email)
              .maybeSingle();

            userData = userByEmail;
          }

          if (userData) {
            // Check superuser status
            setIsSuperUser(userData.is_superuser === true || userData.is_superuser === 'true' || userData.is_superuser === 1);

            // Check collection access (is_collection = true)
            if (userData.employee_id) {
              const { data: employeeData, error: employeeError } = await supabase
                .from('tenants_employee')
                .select('is_collection')
                .eq('id', userData.employee_id)
                .maybeSingle();

              if (!employeeError && employeeData) {
                const collectionStatus = employeeData.is_collection === true ||
                  employeeData.is_collection === 't' ||
                  employeeData.is_collection === 'true' ||
                  employeeData.is_collection === 1;
                setHasCollectionAccess(collectionStatus);
              } else {
                setHasCollectionAccess(false);
              }
            } else {
              setHasCollectionAccess(false);
            }
          }
        }
      } catch (error) {
        console.error('Error fetching user permissions:', error);
      }
    };

    fetchUserPermissions();
  }, []);

  // Close dropdown when report is selected
  useEffect(() => {
    if (selectedReport) {
      setShowSearchDropdown(false);
      setSearchQuery('');
    }
  }, [selectedReport]);

  // Filter reports based on search query, superuser status, and collection access
  const filteredReports = useMemo(() => {
    // First filter by superuser status and collection access
    let reportsToFilter = reports;
    const canAccessTools = isSuperUser || hasCollectionAccess;
    
    if (!isSuperUser) {
      reportsToFilter = reports
        .filter(section => {
          // Show Tools section if user has collection access or is superuser
          if (section.category === 'Tools') {
            return canAccessTools;
          }
          return true;
        })
        .map((section) => {
          // Filter out Sales Contribution from Contribution category if not superuser
          if (section.category === 'Contribution') {
            return {
              ...section,
              items: section.items.filter(item => item.label !== 'Sales Contribution'),
            };
          }
          // Filter Tools items based on permissions
          if (section.category === 'Tools' && canAccessTools) {
            return {
              ...section,
              items: section.items.filter(item => {
                // Re-assign leads requires collection access
                if (item.label === 'Re-assign leads') {
                  return hasCollectionAccess || isSuperUser;
                }
                // Other tools require superuser access
                return isSuperUser;
              }),
            };
          }
          return section;
        })
        .filter((section) => section.items.length > 0); // Remove empty sections
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
  }, [searchQuery, isSuperUser, hasCollectionAccess]);

  return (
    <div className="p-0 md:p-6 space-y-8">
      {!selectedReport ? (
        <>
          <div className="px-4 md:px-0">
            <h1 className="text-4xl font-bold mb-6">Reports</h1>
            {/* Search Bar with Shortcuts */}
            <div className="mb-8">
              <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center">
                {/* Search Input - Modern Style */}
                <div className="relative flex-1 max-w-2xl">
                  <div className="relative">
                    <MagnifyingGlassIcon className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Search reports by name or category..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-12 pr-12 py-4 bg-white border-2 border-gray-200 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition-all duration-200 text-gray-700 placeholder-gray-400"
                    />
                    {searchQuery && (
                      <button
                        onClick={() => setSearchQuery('')}
                        className="absolute right-4 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                      >
                        <XMarkIcon className="w-5 h-5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Shortcut Boxes - Compact Style */}
                <div className="flex flex-wrap gap-3">
                  {/* Finances - Collection */}
                  {(() => {
                    const label = 'Collection';
                    const category = 'Finances';
                    const gradients = [
                      'from-blue-500 to-cyan-500',
                      'from-purple-500 to-pink-500',
                      'from-green-500 to-emerald-500',
                      'from-orange-500 to-red-500',
                      'from-indigo-500 to-blue-500',
                      'from-teal-500 to-cyan-500',
                    ];
                    const cardGradient = gradients[0];

                    return (
                      <button
                        onClick={() => navigate('/reports/collection-finances')}
                        className="group relative overflow-hidden rounded-xl shadow-md hover:shadow-lg transition-all duration-300 transform hover:scale-105 w-[180px] h-14"
                      >
                        {/* Background Gradient */}
                        <div className={`absolute inset-0 bg-gradient-to-br ${cardGradient}`} />

                        {/* Content */}
                        <div className="relative z-10 h-full px-3 flex items-center justify-between text-white">
                          {/* Category Label */}
                          <span className="inline-block px-2 py-0.5 bg-white/20 backdrop-blur-sm rounded-full text-[10px] font-semibold uppercase tracking-wide">
                            {category}
                          </span>

                          {/* Label */}
                          <h3 className="text-sm font-bold drop-shadow-md">
                            {label}
                          </h3>
                        </div>
                      </button>
                    );
                  })()}

                  {/* Finances - Collection Due */}
                  {(() => {
                    const label = 'Collection Due';
                    const category = 'Finances';
                    const cardGradient = 'from-purple-500 to-purple-600';

                    return (
                      <button
                        onClick={() => navigate('/reports/collection-due')}
                        className="group relative overflow-hidden rounded-xl shadow-md hover:shadow-lg transition-all duration-300 transform hover:scale-105 w-[180px] h-14"
                      >
                        {/* Background Gradient */}
                        <div className={`absolute inset-0 bg-gradient-to-br ${cardGradient}`} />

                        {/* Content */}
                        <div className="relative z-10 h-full px-3 flex items-center justify-between text-white">
                          {/* Category Label */}
                          <span className="inline-block px-2 py-0.5 bg-white/20 backdrop-blur-sm rounded-full text-[10px] font-semibold uppercase tracking-wide">
                            {category}
                          </span>

                          {/* Label */}
                          <h3 className="text-sm font-bold drop-shadow-md">
                            {label}
                          </h3>
                        </div>
                      </button>
                    );
                  })()}

                  {/* Sales - Signed */}
                  {(() => {
                    const label = 'Signed';
                    const category = 'Sales';
                    const gradients = [
                      'from-blue-500 to-cyan-500',
                      'from-purple-500 to-pink-500',
                      'from-green-500 to-emerald-500',
                      'from-orange-500 to-red-500',
                      'from-indigo-500 to-blue-500',
                      'from-teal-500 to-cyan-500',
                    ];
                    const cardGradient = gradients[2];

                    return (
                      <button
                        onClick={() => navigate('/sales/signed')}
                        className="group relative overflow-hidden rounded-xl shadow-md hover:shadow-lg transition-all duration-300 transform hover:scale-105 w-[180px] h-14"
                      >
                        {/* Background Gradient */}
                        <div className={`absolute inset-0 bg-gradient-to-br ${cardGradient}`} />

                        {/* Content */}
                        <div className="relative z-10 h-full px-3 flex items-center justify-between text-white">
                          {/* Category Label */}
                          <span className="inline-block px-2 py-0.5 bg-white/20 backdrop-blur-sm rounded-full text-[10px] font-semibold uppercase tracking-wide">
                            {category}
                          </span>

                          {/* Label */}
                          <h3 className="text-sm font-bold drop-shadow-md">
                            {label}
                          </h3>
                        </div>
                      </button>
                    );
                  })()}
                </div>
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
              filteredReports.map((section) => {
                // Generate color gradients for each category
                const categoryColors: { [key: string]: string } = {
                  'Marketing': 'from-blue-500 to-cyan-500',
                  'Meetings': 'from-purple-500 to-pink-500',
                  'Sales': 'from-green-500 to-emerald-500',
                  'Pipelines': 'from-orange-500 to-red-500',
                  'Schedulers': 'from-indigo-500 to-blue-500',
                  'Closers': 'from-teal-500 to-cyan-500',
                  'Experts': 'from-yellow-500 to-orange-500',
                  'Finances': 'from-emerald-500 to-green-500',
                  'Tools': 'from-violet-500 to-purple-500',
                };

                const categoryGradient = categoryColors[section.category] || 'from-gray-500 to-gray-600';

                // Generate contextually relevant image URLs for each report
                const getReportImage = (label: string, category: string) => {
                  // Map report labels to relevant image search terms
                  // Use composite key (category + label) for reports with same label in different categories
                  const imageMap: { [key: string]: string } = {
                    // Marketing
                    'Sources pie': 'pie-chart-data-visualization',
                    'Category & source': 'analytics-data-dashboard',
                    'Convertion': 'funnel-conversion-marketing',
                    'Convertion Steps': 'funnel-steps-process',

                    // Meetings
                    'Scheduled': 'calendar-schedule-meeting',
                    'Rescheduled': 'calendar-reschedule',
                    'Results': 'meeting-results-success',

                    // Sales
                    'Signed': 'contract-signature-document',
                    'Bonuses (v4)': 'bonus-money-reward',
                    'Actual': 'sales-actual-performance',
                    'Target': 'target-goal-achievement',

                    // Pipelines
                    'Expert': 'expert-professional-analysis',
                    'General Sales': 'sales-pipeline-workflow',
                    'Employee': 'employee-pipeline',
                    'Unhandled': 'unhandled-pending',

                    // Schedulers - use composite key to distinguish from Closers
                    'Schedulers|Super Pipeline': 'scheduler-calendar-workflow',
                    'Schedulers Quality': 'quality-check-review',
                    'Performance': 'performance-metrics-chart',
                    'Performance by Cat.': 'performance-category-analysis',

                    // Closers - use composite key to distinguish from Schedulers
                    'Closers|Super Pipeline': 'closing-deal-handshake',
                    'Closers Quality': 'quality-assessment',

                    // Experts
                    'Experts Assignment': 'expert-assignment-task',
                    'Experts Results': 'results-analysis-report',

                    // Finances
                    'Collection': 'money-collection-payment',
                    'Collection Due': 'payment-due-invoice',
                    'Profitability': 'profitability-financial-growth',

                    // Tools
                    'Edit Contracts': 'contract-document-edit',
                    'Employee Unavailabilities': 'calendar-unavailable-time-off',
                    'Employee Salaries': 'salary-payment-money',
                    
                    // Employees
                    'Employee Info': 'employee-contact-information',
                  };

                  // Check for composite key first (category|label), then just label
                  const compositeKey = `${category}|${label}`;
                  const searchTerm = imageMap[compositeKey] || imageMap[label] || (() => {
                    const categoryDefaults: { [key: string]: string } = {
                      'Marketing': 'marketing-analytics',
                      'Meetings': 'meeting-calendar',
                      'Sales': 'sales-performance',
                      'Pipelines': 'pipeline-workflow',
                      'Schedulers': 'scheduler-calendar',
                      'Closers': 'closing-deal',
                      'Experts': 'expert-professional',
                      'Finances': 'finance-money',
                      'Tools': 'tools-utilities',
                      'Employees': 'employee-team',
                    };
                    return categoryDefaults[category] || 'business';
                  })();

                  // Generate a consistent seed based on category + label for reproducible images
                  // This ensures different images for same label in different categories
                  const seedString = `${category}-${label}`;
                  const seed = seedString.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);

                  // Use Picsum Photos - very reliable service that provides actual photos
                  // The seed ensures the same image is shown for the same report
                  // Format: https://picsum.photos/seed/{seed}/400/300
                  return `https://picsum.photos/seed/${seed}/400/300`;
                };

                return (
                  <div key={section.category}>
                    <h2 className="text-2xl font-semibold mb-4">{section.category}</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6">
                      {section.items.map((item, index) => {
                        // Generate unique gradient for each card
                        const gradients = [
                          'from-blue-500 to-cyan-500',
                          'from-purple-500 to-pink-500',
                          'from-green-500 to-emerald-500',
                          'from-orange-500 to-red-500',
                          'from-indigo-500 to-blue-500',
                          'from-teal-500 to-cyan-500',
                          'from-yellow-500 to-orange-500',
                          'from-rose-500 to-pink-500',
                          'from-violet-500 to-purple-500',
                          'from-amber-500 to-yellow-500',
                        ];
                        const cardGradient = gradients[index % gradients.length];

                        // Use different images for Edit Contracts and Employee Unavailabilities
                        let imageUrl: string;
                        if (item.label === 'Edit Contracts') {
                          // Use a different seed for Edit Contracts
                          imageUrl = 'https://picsum.photos/seed/edit-contracts-document/400/300';
                        } else if (item.label === 'Employee Unavailabilities') {
                          // Use a different seed for Employee Unavailabilities
                          imageUrl = 'https://picsum.photos/seed/employee-unavailabilities-calendar/400/300';
                        } else {
                          imageUrl = getReportImage(item.label, section.category);
                        }

                        return (
                          <button
                            key={item.label}
                            className="group relative overflow-hidden rounded-2xl shadow-lg hover:shadow-2xl transition-all duration-300 transform hover:scale-105"
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
                            {/* Background Gradient (always visible) */}
                            <div className={`absolute inset-0 bg-gradient-to-br ${cardGradient}`} />

                            {/* Background Image (optional overlay) */}
                            <img
                              src={imageUrl}
                              alt={item.label}
                              className="absolute inset-0 w-full h-full object-cover opacity-40"
                              onError={(e) => {
                                // Hide image on error, gradient will show through
                                (e.target as HTMLImageElement).style.display = 'none';
                              }}
                            />

                            {/* Content */}
                            <div className="relative z-10 p-6 md:p-8 min-h-[200px] flex flex-col justify-between text-white">
                              {/* Category Label */}
                              <div className="mb-4 flex items-center justify-between gap-2">
                                <span className="inline-block px-3 py-1 bg-white/20 backdrop-blur-sm rounded-full text-xs font-semibold uppercase tracking-wide">
                                  {section.category}
                                </span>
                                <div className="flex items-center gap-2">
                                  {/* Under Construction Badge */}
                                  {(section.category === 'Marketing' ||
                                    (section.category === 'Contribution' && item.label === 'All') ||
                                    item.label === 'Bonuses (v4)') && (
                                      <span className="inline-flex items-center gap-1 px-2 py-1 bg-yellow-500/90 backdrop-blur-sm rounded-full text-[10px] font-semibold uppercase tracking-wide text-white">
                                        <WrenchScrewdriverIcon className="w-3 h-3 text-white" />
                                        Under Construction
                                      </span>
                                    )}
                                  {/* Admin Access Only Badge */}
                                  {(item.label === 'Sales Contribution' ||
                                    item.label === 'Edit Contracts' ||
                                    item.label === 'Employee Unavailabilities' ||
                                    item.label === 'Employee Salaries') && (
                                      <span className="inline-block px-2 py-1 bg-red-500/90 backdrop-blur-sm rounded-full text-[10px] font-semibold uppercase tracking-wide text-white">
                                        Admin access only!
                                      </span>
                                    )}
                                </div>
                              </div>

                              {/* Icon and Label */}
                              <div className="flex-1 flex flex-col items-center justify-center">
                                <item.icon className="w-16 h-16 md:w-20 md:h-20 mb-4 text-white drop-shadow-lg" />
                                <h3 className="text-lg md:text-xl font-bold text-center drop-shadow-md">
                                  {item.label}
                                </h3>
                              </div>

                              {/* View Report Button */}
                              <div className="mt-4 flex justify-end">
                                <span className="inline-flex items-center px-4 py-2 bg-white/20 backdrop-blur-sm rounded-full text-sm font-semibold hover:bg-white/30 transition-colors">
                                  View report <span className="ml-2">→</span>
                                </span>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })
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
                          className={`w-full text-left px-4 py-2 rounded-md hover:bg-primary hover:text-white transition-colors flex items-center gap-3 ${selectedReport?.label === item.label ? 'bg-primary text-white' : 'bg-gray-50'
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