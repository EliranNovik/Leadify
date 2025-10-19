import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { 
  PhoneIcon,
  UserIcon,
  MagnifyingGlassIcon,
  MicrophoneIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ArrowPathIcon,
  CloudArrowDownIcon
} from '@heroicons/react/24/outline';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { onecomSyncApi } from '../lib/onecomSyncApi';
import AudioPlayerModal from '../components/AudioPlayerModal';

interface CallLog {
  id: number;
  cdate: string;
  udate?: string;
  direction?: string;
  date?: string;
  time?: string;
  source?: string;
  incomingdid?: string;
  destination?: string;
  status?: string;
  url?: string;
  call_id?: string;
  duration?: number;
  lead_id?: number;
  lead_interaction_id?: number;
  employee_id?: number;
  employee?: {
    display_name: string;
  };
}

const CallsLedgerPage: React.FC = () => {
  const navigate = useNavigate();
  const [callLogs, setCallLogs] = useState<CallLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [appliedFromDate, setAppliedFromDate] = useState<string>('');
  const [appliedToDate, setAppliedToDate] = useState<string>('');
  const [totalCalls, setTotalCalls] = useState(0);
  const [totalDuration, setTotalDuration] = useState(0);
  const [employees, setEmployees] = useState<any[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState<string>('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{
    synced: number;
    skipped: number;
    total: number;
    errors: number;
  } | null>(null);
  
  // Audio player modal state
  const [isAudioModalOpen, setIsAudioModalOpen] = useState(false);
  const [currentRecordingUrl, setCurrentRecordingUrl] = useState<string>('');
  const [currentCallId, setCurrentCallId] = useState<string>('');
  const [currentEmployeeName, setCurrentEmployeeName] = useState<string>('');

  // Fetch employees for dropdown
  const fetchEmployees = async () => {
    try {
      const { data, error } = await supabase
        .from('tenants_employee')
        .select('id, display_name')
        .not('display_name', 'is', null)
        .order('display_name', { ascending: true });

      if (error) {
        console.error('Error fetching employees:', error);
        return;
      }

      setEmployees(data || []);
    } catch (error) {
      console.error('Error fetching employees:', error);
    }
  };

  // Set default dates to today and fetch employees
  useEffect(() => {
    const today = new Date().toISOString().split('T')[0];
    setFromDate(today);
    setToDate(today);
    setAppliedFromDate(today);
    setAppliedToDate(today);
    
    // Fetch employees on component mount
    fetchEmployees();
  }, []);

  const fetchCallLogs = async () => {
    if (!appliedFromDate || !appliedToDate) return;

    try {
      setLoading(true);
      
      let query = supabase
        .from('call_logs')
        .select(`
          id,
          cdate,
          date,
          time,
          source,
          incomingdid,
          destination,
          direction,
          status,
          url,
          call_id,
          action,
          duration,
          lead_id,
          employee_id,
          tenants_employee!employee_id (
            display_name
          )
        `)
        .gte('date', appliedFromDate)
        .lte('date', appliedToDate);

      // Add employee filter if selected
      if (selectedEmployee) {
        query = query.eq('employee_id', selectedEmployee);
      }

      const { data, error } = await query
        .order('date', { ascending: false })
        .order('time', { ascending: false })
        .limit(1000);

      if (error) {
        console.error('Error fetching call logs:', error);
        toast.error('Failed to fetch call logs');
        return;
      }

      // Process the data to flatten the employee join
      const processedData = data?.map((call: any) => ({
        ...call,
        employee: Array.isArray(call.tenants_employee) ? call.tenants_employee[0] : call.tenants_employee
      })) || [];

      setCallLogs(processedData);

      // Calculate totals
      const total = processedData.length;
      const duration = processedData.reduce((sum: number, call: CallLog) => sum + (call.duration || 0), 0);
      
      setTotalCalls(total);
      setTotalDuration(duration);

    } catch (error) {
      console.error('Error fetching call logs:', error);
      toast.error('Failed to fetch call logs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCallLogs();
  }, [appliedFromDate, appliedToDate, selectedEmployee]);

  const handleApplyFilters = () => {
    setAppliedFromDate(fromDate);
    setAppliedToDate(toDate);
    // Employee filter is applied immediately when changed, no need to set it here
  };

  const navigateDates = (direction: 'back' | 'forward') => {
    const fromDateObj = new Date(fromDate);
    const toDateObj = new Date(toDate);
    
    if (direction === 'back') {
      fromDateObj.setDate(fromDateObj.getDate() - 1);
      toDateObj.setDate(toDateObj.getDate() - 1);
    } else {
      fromDateObj.setDate(fromDateObj.getDate() + 1);
      toDateObj.setDate(toDateObj.getDate() + 1);
    }
    
    const newFromDate = fromDateObj.toISOString().split('T')[0];
    const newToDate = toDateObj.toISOString().split('T')[0];
    
    setFromDate(newFromDate);
    setToDate(newToDate);
    setAppliedFromDate(newFromDate);
    setAppliedToDate(newToDate);
  };

  const goToToday = () => {
    const today = new Date().toISOString().split('T')[0];
    setFromDate(today);
    setToDate(today);
    setAppliedFromDate(today);
    setAppliedToDate(today);
  };

  const handleLeadClick = (leadId: number) => {
    navigate(`/clients/${leadId}`);
  };

  const formatDuration = (seconds: number): string => {
    return `${seconds}s`;
  };

  const formatTotalDuration = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (hours > 0) {
      return `${hours}h${minutes.toString().padStart(2, '0')}m`;
    } else {
      return `${minutes}m`;
    }
  };

  const handlePlayRecording = async (recordingUrl: string, callId: string, employeeName?: string) => {
    try {
      // Validate and clean the recording URL
      let cleanUrl = recordingUrl;
      
      // Check if URL is absolute (handle both encoded and unencoded URLs)
      let decodedUrl = recordingUrl;
      try {
        // Try to decode the URL first
        decodedUrl = decodeURIComponent(recordingUrl);
      } catch (error) {
        // If decoding fails, use the original URL
        decodedUrl = recordingUrl;
      }
      const isAbsolute = decodedUrl.startsWith('http://') || decodedUrl.startsWith('https://');
      
      if (!isAbsolute) {
        console.error('Invalid recording URL:', recordingUrl);
        toast.error('Invalid recording URL');
        return;
      }

      // For 1com URLs, extract call ID and use our proxy endpoint
      if (decodedUrl.includes('pbx6webserver.1com.co.il')) {
        try {
          // Extract call ID from the URL
          const urlParams = new URL(decodedUrl).searchParams;
          const extractedCallId = urlParams.get('id');
          const tenant = urlParams.get('tenant');
          
          if (!extractedCallId) {
            console.error('Could not extract call ID from URL:', decodedUrl);
            toast.error('Invalid recording URL format');
            return;
          }
          
          // Use our backend proxy to avoid CORS issues
          const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
          cleanUrl = `${backendUrl}/api/call-recording/${extractedCallId}${tenant ? `?tenant=${tenant}` : ''}`;
        } catch (error) {
          console.error('Error parsing 1com URL:', error);
          toast.error('Failed to parse recording URL');
          return;
        }
      }

      // Open the audio player modal
      setCurrentRecordingUrl(cleanUrl);
      setCurrentCallId(callId);
      setCurrentEmployeeName(employeeName || '');
      setIsAudioModalOpen(true);
    } catch (error) {
      console.error('Error preparing recording:', error);
      toast.error('Failed to load recording');
    }
  };

  const handleCloseAudioModal = () => {
    setIsAudioModalOpen(false);
    setCurrentRecordingUrl('');
    setCurrentCallId('');
    setCurrentEmployeeName('');
  };

  const handleSyncFromOneCom = async () => {
    if (!appliedFromDate || !appliedToDate) {
      toast.error('Please select a date range first');
      return;
    }

    setIsSyncing(true);
    setSyncProgress(null);

    try {
      console.log('🔄 Starting 1com sync...');
      const result = await onecomSyncApi.syncCallLogs({
        startDate: appliedFromDate,
        endDate: appliedToDate
      });

      if (result.success) {
        toast.success(result.message);
        if (result.data) {
          setSyncProgress({
            synced: result.data.synced,
            skipped: result.data.skipped,
            total: result.data.synced + result.data.skipped + (result.data.errors?.length || 0),
            errors: result.data.errors?.length || 0
          });
        }
        
        // Refresh call logs after successful sync
        await fetchCallLogs();
      } else {
        toast.error(result.message || 'Sync failed');
        console.error('❌ Sync failed:', result.error);
      }
    } catch (error) {
      console.error('❌ Sync error:', error);
      toast.error('Sync failed due to an unexpected error');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleQuickSyncToday = async () => {
    setIsSyncing(true);
    setSyncProgress(null);

    try {
      console.log('🔄 Starting quick sync for today...');
      const result = await onecomSyncApi.syncToday();

      if (result.success) {
        toast.success(result.message);
        if (result.data) {
          setSyncProgress({
            synced: result.data.synced,
            skipped: result.data.skipped,
            total: result.data.synced + result.data.skipped + (result.data.errors?.length || 0),
            errors: result.data.errors?.length || 0
          });
        }
        
        // Refresh call logs after successful sync
        await fetchCallLogs();
      } else {
        toast.error(result.message || 'Today sync failed');
        console.error('❌ Today sync failed:', result.error);
      }
    } catch (error) {
      console.error('❌ Today sync error:', error);
      toast.error('Today sync failed due to an unexpected error');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleQuickSyncLastWeek = async () => {
    setIsSyncing(true);
    setSyncProgress(null);

    try {
      console.log('🔄 Starting quick sync for last week...');
      const result = await onecomSyncApi.syncLastWeek();

      if (result.success) {
        toast.success(result.message);
        if (result.data) {
          setSyncProgress({
            synced: result.data.synced,
            skipped: result.data.skipped,
            total: result.data.synced + result.data.skipped + (result.data.errors?.length || 0),
            errors: result.data.errors?.length || 0
          });
        }
        
        // Refresh call logs after successful sync
        await fetchCallLogs();
      } else {
        toast.error(result.message || 'Last week sync failed');
        console.error('❌ Last week sync failed:', result.error);
      }
    } catch (error) {
      console.error('❌ Last week sync error:', error);
      toast.error('Last week sync failed due to an unexpected error');
    } finally {
      setIsSyncing(false);
    }
  };

  const getStatusBadge = (status?: string) => {
    if (!status) return <span className="badge badge-neutral">Unknown</span>;
    
    const statusLower = status.toLowerCase();
    
    // Handle exact matches first (from 1com API)
    if (statusLower === 'answered') {
      return <span className="badge badge-success">Answered</span>;
    } else if (statusLower === 'no+answer' || statusLower === 'no answer') {
      return <span className="badge badge-error">Not Answered</span>;
    } else if (statusLower === 'failed') {
      return <span className="badge badge-error">Failed</span>;
    } else if (statusLower === 'cancelled') {
      return <span className="badge badge-warning">Cancelled</span>;
    } else if (statusLower === 'redirected') {
      return <span className="badge badge-info">Redirected</span>;
    } else if (statusLower === 'busy') {
      return <span className="badge badge-warning">Busy</span>;
    } else if (statusLower === 'congestion') {
      return <span className="badge badge-error">Failed</span>;
    }
    
    // Handle partial matches for other variations
    if (statusLower.includes('no+answer') || statusLower.includes('noanswer')) {
      return <span className="badge badge-error">Not Answered</span>;
    } else if (statusLower.includes('answer') && !statusLower.includes('no')) {
      return <span className="badge badge-success">Answered</span>;
    } else if (statusLower.includes('busy')) {
      return <span className="badge badge-warning">Busy</span>;
    } else if (statusLower.includes('failed')) {
      return <span className="badge badge-error">Failed</span>;
    } else {
      return <span className="badge badge-neutral">{status}</span>;
    }
  };

  const cleanIncomingDID = (did?: string) => {
    if (!did) return '---';
    // Remove all non-numeric characters and return only numbers
    const cleaned = did.replace(/\D/g, '');
    return cleaned || '---';
  };

  return (
    <div className="min-h-screen bg-white w-full p-4 sm:p-6 md:p-8">
                {/* Header */}
                <div className="flex items-center justify-between mb-8">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#3f2bcd' }}>
                      <PhoneIcon className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <h1 className="text-2xl font-bold text-gray-900">Calls Ledger</h1>
                      <p className="text-sm text-gray-500">Telephone call logs and recordings</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      className="btn btn-outline btn-sm"
                      onClick={handleQuickSyncToday}
                      disabled={isSyncing}
                      title="Sync today's calls from 1com"
                    >
                      {isSyncing ? (
                        <span className="loading loading-spinner loading-xs"></span>
                      ) : (
                        <CloudArrowDownIcon className="w-4 h-4" />
                      )}
                      <span className="hidden sm:inline">Sync Today</span>
                    </button>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={handleSyncFromOneCom}
                      disabled={isSyncing}
                      title="Sync calls from 1com for selected date range"
                    >
                      {isSyncing ? (
                        <span className="loading loading-spinner loading-xs"></span>
                      ) : (
                        <ArrowPathIcon className="w-4 h-4" />
                      )}
                      <span className="hidden sm:inline">Sync 1com</span>
                    </button>
                  </div>
                </div>

        {/* Filters */}
        <div className="mb-6">
          <h4 className="text-lg font-semibold text-gray-900 mb-4">Filters</h4>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-500 uppercase tracking-wide">From Date</label>
              <input
                type="date"
                className="input input-bordered w-full cursor-pointer"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
            </div>
            
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-500 uppercase tracking-wide">To Date</label>
              <input
                type="date"
                className="input input-bordered w-full cursor-pointer"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-500 uppercase tracking-wide">Employee</label>
              <select 
                className="select select-bordered w-full"
                value={selectedEmployee}
                onChange={(e) => setSelectedEmployee(e.target.value)}
              >
                <option value="">All</option>
                {employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.display_name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-500 uppercase tracking-wide">Navigate</label>
              <div className="flex items-center gap-1">
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => navigateDates('back')}
                  title="Previous Day"
                >
                  <ChevronLeftIcon className="w-4 h-4" />
                </button>
                <button
                  className="btn btn-primary btn-sm text-xs"
                  onClick={goToToday}
                  title="Go to Today"
                >
                  Today
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => navigateDates('forward')}
                  title="Next Day"
                >
                  <ChevronRightIcon className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div>
              <button
                className="btn btn-primary w-full"
                onClick={handleApplyFilters}
                disabled={loading}
              >
                <MagnifyingGlassIcon className="w-4 h-4" />
                Show
              </button>
            </div>
          </div>
        </div>

                {/* Summary */}
                <div className="mb-6">
                  <h4 className="text-lg font-semibold text-gray-900 mb-4">Summary</h4>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <PhoneIcon className="w-5 h-5 text-green-600" />
                      <span className="text-lg font-semibold text-gray-900">
                        Total: {totalCalls} ({formatTotalDuration(totalDuration)})
                      </span>
                    </div>
                    {selectedEmployee && (
                      <div className="flex items-center gap-2">
                        <UserIcon className="w-4 h-4 text-blue-600" />
                        <span className="text-sm text-blue-600 font-medium">
                          Filtered by: {employees.find(emp => emp.id === parseInt(selectedEmployee))?.display_name}
                        </span>
                      </div>
                    )}
                    {syncProgress && (
                      <div className="flex items-center gap-2">
                        <ArrowPathIcon className="w-4 h-4 text-purple-600" />
                        <span className="text-sm text-purple-600 font-medium">
                          Last sync: {syncProgress.synced} synced, {syncProgress.skipped} skipped
                          {syncProgress.errors > 0 && `, ${syncProgress.errors} errors`}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

        {/* Call Logs Table */}
        <div className="bg-white border border-gray-200 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h4 className="text-lg font-semibold text-gray-900">Call Logs</h4>
          </div>
          <div className="overflow-x-auto">
            <table className="table w-full compact-table">
              <thead>
                <tr>
                  <th className="px-2 py-2 text-sm font-semibold">Call ID</th>
                  <th className="px-2 py-2 text-sm font-semibold">Date</th>
                  <th className="px-2 py-2 text-sm font-semibold">Time</th>
                  <th className="px-2 py-2 text-sm font-semibold">Source</th>
                  <th className="px-2 py-2 text-sm font-semibold">Destination</th>
                  <th className="px-2 py-2 text-sm font-semibold">Incoming DID</th>
                  <th className="px-2 py-2 text-sm font-semibold">Direction</th>
                  <th className="px-2 py-2 text-sm font-semibold">Status</th>
                  <th className="px-2 py-2 text-sm font-semibold">Duration</th>
                  <th className="px-2 py-2 text-sm font-semibold">Lead</th>
                  <th className="px-2 py-2 text-sm font-semibold">Employee</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={11} className="text-center py-8">
                      <div className="flex items-center justify-center gap-2">
                        <span className="loading loading-spinner loading-md"></span>
                        <span className="text-gray-500">Loading call logs...</span>
                      </div>
                    </td>
                  </tr>
                ) : callLogs.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="text-center py-8">
                      <div className="flex flex-col items-center gap-2">
                        <PhoneIcon className="w-12 h-12 text-gray-300" />
                        <p className="text-gray-500 font-medium">No calls found</p>
                        <p className="text-sm text-gray-400">Try adjusting your date range</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  callLogs.map((call) => (
                    <tr key={call.id} className="hover:bg-gray-50">
                      <td className="px-2 py-2 font-mono text-sm">{call.call_id || '---'}</td>
                      <td className="px-2 py-2 text-sm">
                        {call.date ? new Date(call.date).toLocaleDateString('en-GB') : '---'}
                      </td>
                      <td className="px-2 py-2 text-sm">
                        {call.time ? call.time.substring(0, 5) : '---'}
                      </td>
                      <td className="px-2 py-2 font-mono text-sm">{call.source || '---'}</td>
                      <td className="px-2 py-2 font-mono text-sm">{call.destination || '---'}</td>
                      <td className="px-2 py-2 font-mono text-sm">{cleanIncomingDID(call.incomingdid)}</td>
                      <td className="px-2 py-2 text-sm">{call.direction || '---'}</td>
                      <td className="px-2 py-2">{getStatusBadge(call.status)}</td>
                      <td className="px-2 py-2 text-sm">
                        {call.duration ? formatDuration(call.duration) : '---'}
                      </td>
                      <td className="px-2 py-2">
                        {call.lead_id ? (
                          <button
                            className="text-blue-600 hover:text-blue-800 underline font-medium text-sm"
                            onClick={() => handleLeadClick(call.lead_id!)}
                          >
                            {call.lead_id}
                          </button>
                        ) : (
                          <span className="text-sm">---</span>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex items-center justify-between">
                          <span className="text-sm">{call.employee?.display_name || '---'}</span>
                          {call.url && (
                            <button
                              className="btn btn-ghost btn-sm flex items-center justify-center hover:bg-purple-50"
                              onClick={() => handlePlayRecording(call.url!, call.call_id || String(call.id), call.employee?.display_name)}
                              title="Play Recording"
                            >
                              <MicrophoneIcon className="w-5 h-5 text-purple-600" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Audio Player Modal */}
        <AudioPlayerModal
          isOpen={isAudioModalOpen}
          onClose={handleCloseAudioModal}
          audioUrl={currentRecordingUrl}
          callId={currentCallId}
          employeeName={currentEmployeeName}
        />
    </div>
  );
};

export default CallsLedgerPage;
