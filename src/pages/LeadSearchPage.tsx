import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, type Lead } from '../lib/supabase';
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';

const LeadSearchPage: React.FC = () => {
  const [filters, setFilters] = useState({
    fromDate: '',
    toDate: '',
    category: '',
    language: '',
    reason: '',
    tags: '',
    fileId: '',
    status: '',
    source: '',
    eligibilityDeterminedOnly: false,
    stage: '',
    topic: '',
    content: '',
  });
  const [results, setResults] = useState<Lead[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchPerformed, setSearchPerformed] = useState(false);
  const navigate = useNavigate();

  // Dropdown options
  const categoryOptions = ["Manual", "AI Assistant", "Referral", "Website", "Other"];
  const languageOptions = ["English", "Hebrew", "German", "French", "Russian", "Other"];
  const reasonOptions = ["Inquiry", "Follow-up", "Complaint", "Consultation", "Other"];
  const tagOptions = ["VIP", "Urgent", "Family", "Business", "Other"];
  const statusOptions = ["new", "in_progress", "qualified", "not_qualified"];
  const sourceOptions = ["Manual", "AI Assistant", "Referral", "Website", "Other"];
  const stageOptions = [
    "created", "scheduler_assigned", "meeting_scheduled", "meeting_paid", "unactivated", "communication_started", "another_meeting", "revised_offer", "offer_sent", "waiting_for_mtng_sum", "client_signed", "client_declined", "lead_summary", "meeting_rescheduled", "meeting_ended"
  ];
  const topicOptions = ["German Citizenship", "Austrian Citizenship", "Inquiry", "Consultation", "Other"];

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
      if (filters.category) query = query.ilike('category', `%${filters.category}%`);
      if (filters.language) query = query.eq('language', filters.language);
      if (filters.status) query = query.eq('status', filters.status);
      if (filters.stage) query = query.eq('stage', filters.stage);
      if (filters.source) query = query.ilike('source', `%${filters.source}%`);
      if (filters.topic) query = query.ilike('topic', `%${filters.topic}%`);
      if (filters.tags) query = query.ilike('tags', `%${filters.tags}%`);
      if (filters.fileId) query = query.ilike('lead_number', `%${filters.fileId}%`);
      if (filters.content) {
        query = query.or(`facts.ilike.%${filters.content}%,special_notes.ilike.%${filters.content}%,general_notes.ilike.%${filters.content}%`);
      }
      if (filters.eligibilityDeterminedOnly) {
        query = query.not('eligibility_status', 'is', null);
      }

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
    switch (stage) {
      case 'created':
      case 'scheduler_assigned':
        return <span className="badge badge-info">{stageText}</span>;
      case 'communication_started':
      case 'meeting_rescheduled':
      case 'revised_offer':
        return <span className="badge badge-warning">{stageText}</span>;
      case 'meeting_scheduled':
      case 'another_meeting':
      case 'offer_sent':
      case 'waiting_for_mtng_sum':
        return <span className="badge badge-info bg-sky-200 text-sky-800 border-sky-300">{stageText}</span>
      case 'meeting_paid':
      case 'client_signed':
      case 'meeting_ended':
        return <span className="badge badge-success">{stageText}</span>;
      case 'unactivated':
      case 'client_declined':
        return <span className="badge badge-error">{stageText}</span>;
      case 'lead_summary':
        return <span className="badge badge-neutral">{stageText}</span>;
      default:
        return <span className="badge">{stageText}</span>;
    }
  };

  const renderResultCard = (lead: Lead) => (
    <div 
      key={lead.id} 
      className="card bg-base-100 shadow-lg hover:shadow-2xl transition-all duration-300 ease-in-out transform hover:-translate-y-1 cursor-pointer group"
      onClick={() => navigate(`/clients/${lead.lead_number}`)}
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
    <div className="p-6 md:p-10">
      <h1 className="text-3xl font-bold mb-6">Leads Search</h1>

      {/* Search Form */}
      <div className="card bg-base-200 shadow-lg p-6 mb-8">
        <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
          {/* Column 1 */}
          <div className="form-control flex flex-col col-span-2 sm:col-span-1">
            <label className="label mb-2"><span className="label-text">From date</span></label>
            <input type="date" className="input input-bordered" onChange={e => handleFilterChange('fromDate', e.target.value)} />
          </div>
          <div className="form-control flex flex-col col-span-2 sm:col-span-1">
            <label className="label mb-2"><span className="label-text">Category</span></label>
            <select className="select select-bordered" onChange={e => handleFilterChange('category', e.target.value)}>
              <option value="">Please choose</option>
              {categoryOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          </div>
          <div className="form-control flex flex-col col-span-2 sm:col-span-1">
            <label className="label mb-2"><span className="label-text">Reason</span></label>
            <select className="select select-bordered" onChange={e => handleFilterChange('reason', e.target.value)}>
              <option value="">Please choose</option>
              {reasonOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          </div>
          <div className="form-control flex flex-col col-span-2 sm:col-span-1">
            <label className="label mb-2"><span className="label-text">File id</span></label>
            <input type="text" className="input input-bordered" onChange={e => handleFilterChange('fileId', e.target.value)} />
          </div>

          {/* Column 2 */}
          <div className="form-control flex flex-col col-span-2 sm:col-span-1">
            <label className="label mb-2"><span className="label-text">To date</span></label>
            <input type="date" className="input input-bordered" onChange={e => handleFilterChange('toDate', e.target.value)} />
          </div>
          <div className="form-control flex flex-col col-span-2 sm:col-span-1">
            <label className="label mb-2"><span className="label-text">Language</span></label>
            <select className="select select-bordered" onChange={e => handleFilterChange('language', e.target.value)}>
              <option value="">Please choose</option>
              {languageOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          </div>
          <div className="form-control flex flex-col col-span-2 sm:col-span-1">
            <label className="label mb-2"><span className="label-text">Tags</span></label>
            <select className="select select-bordered" onChange={e => handleFilterChange('tags', e.target.value)}>
              <option value="">Please choose</option>
              {tagOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          </div>

          {/* Column 3 */}
          <div className="form-control flex flex-col col-span-2 sm:col-span-1">
            <label className="label mb-2"><span className="label-text">Status</span></label>
            <select className="select select-bordered" onChange={e => handleFilterChange('status', e.target.value)}>
              <option value="">Please choose</option>
              {statusOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          </div>
          <div className="form-control flex flex-col col-span-2 sm:col-span-1">
            <label className="label mb-2"><span className="label-text">Source</span></label>
            <select className="select select-bordered" onChange={e => handleFilterChange('source', e.target.value)}>
              <option value="">Please choose</option>
              {sourceOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          </div>
          <div className="form-control flex flex-col col-span-2 sm:col-span-1">
            <label className="label cursor-pointer justify-start gap-2 mb-2">
              <span className="label-text">Eligibility Determined only</span> 
              <input type="checkbox" className="checkbox checkbox-primary" onChange={e => handleFilterChange('eligibilityDeterminedOnly', e.target.checked)} />
            </label>
          </div>

          {/* Column 4 */}
          <div className="form-control flex flex-col col-span-2 sm:col-span-1">
            <label className="label mb-2"><span className="label-text">Stage</span></label>
            <select className="select select-bordered" onChange={e => handleFilterChange('stage', e.target.value)}>
              <option value="">Please choose</option>
              {stageOptions.map(opt => <option key={opt} value={opt}>{opt.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</option>)}
            </select>
          </div>
          <div className="form-control flex flex-col col-span-2 sm:col-span-1">
            <label className="label mb-2"><span className="label-text">Topic</span></label>
            <select className="select select-bordered" onChange={e => handleFilterChange('topic', e.target.value)}>
              <option value="">Please choose</option>
              {topicOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          </div>
          <div className="form-control flex flex-col col-span-2 sm:col-span-1">
            <label className="label mb-2"><span className="label-text">Content</span></label>
            <input type="text" className="input input-bordered" onChange={e => handleFilterChange('content', e.target.value)} />
          </div>
          
          {/* Search Button: span both columns on mobile */}
          <div className="col-span-2 flex items-end">
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

export default LeadSearchPage; 