import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { CalendarIcon, ClockIcon } from '@heroicons/react/24/outline';

interface AccessLog {
  id: number;
  created_at: string;
  request_method: string;
  endpoint: string;
  request_body: string;
  response_body: string;
  response_code: number;
  ip_address?: string;
  user_agent?: string;
}

interface ExpandedRow {
  [key: number]: boolean;
}

const escapeIlikePattern = (value: string) => value.replace(/[%_]/g, '\\$&');

const HOOK_ENDPOINTS = ['/api/hook/catch', '/api/hook/facebook'];

const AccessLogsManager: React.FC = () => {
  const [logs, setLogs] = useState<AccessLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [expandedRows, setExpandedRows] = useState<ExpandedRow>({});
  const [filters, setFilters] = useState({
    endpoint: '',
    responseCode: '',
    searchTerm: '',
    dateFrom: '',
    dateTo: ''
  });
  const [availableResponseCodes, setAvailableResponseCodes] = useState<number[]>([]);

  const fetchLogs = async () => {
    try {
      setLoading(true);
      setError(null);

      console.log('Fetching access logs for /api/hook/catch endpoint...');

      // First, check if user is authenticated
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      console.log('Current user:', user);
      console.log('User error:', userError);

      let query = supabase
        .from('access_logs')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false });

      if (filters.endpoint && filters.endpoint.trim() !== '') {
        query = query.eq('endpoint', filters.endpoint.trim());
      } else {
        query = query.in('endpoint', HOOK_ENDPOINTS);
      }

      // Apply additional filters (excluding endpoint filter since we're already filtering for /api/hook/catch)
      if (filters.responseCode && filters.responseCode.trim() !== '') {
        const responseCodeNum = parseInt(filters.responseCode, 10);
        if (!isNaN(responseCodeNum)) {
          query = query.eq('response_code', responseCodeNum);
        }
      }
      if (filters.searchTerm && filters.searchTerm.trim() !== '') {
        const escapedSearch = escapeIlikePattern(filters.searchTerm.trim());
        query = query.ilike('request_body', `%${escapedSearch}%`);
      }
      if (filters.dateFrom) {
        query = query.gte('created_at', filters.dateFrom);
      }
      if (filters.dateTo) {
        query = query.lte('created_at', filters.dateTo);
      }

      // Pagination
      const pageSize = 50;
      const from = (currentPage - 1) * pageSize;
      const to = from + pageSize - 1;
      
      query = query.range(from, to);

      const { data, error, count } = await query;

      console.log('Query result:', { data, error, count });

      if (error) {
        console.error('Supabase error:', error);
        throw error;
      }

      const fetchedLogs = data || [];
      setLogs(fetchedLogs);
      const uniqueCodes = Array.from(
        new Set(
          fetchedLogs
            .map((log) => log.response_code)
            .filter((code) => typeof code === 'number')
        )
      ).sort((a, b) => a - b);
      setAvailableResponseCodes(uniqueCodes);
      setTotalPages(Math.ceil((count || 0) / pageSize));
    } catch (err) {
      console.error('Error fetching access logs:', err);
      setError(`Failed to fetch access logs: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [currentPage, filters]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    
    return {
      date: `${day}/${month}/${year}`,
      time: `${hours}:${minutes}`
    };
  };

  const truncateText = (text: string, maxLength: number = 100) => {
    if (!text) return '';
    return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
  };

  const getResponseCodeColor = (code: number) => {
    if (code >= 200 && code < 300) return 'text-green-600';
    if (code >= 400 && code < 500) return 'text-yellow-600';
    if (code >= 500) return 'text-red-600';
    return 'text-gray-600';
  };

const getMethodColor = (method: string) => {
  switch (method.toUpperCase()) {
    case 'GET': return 'bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white';
    case 'POST': return 'bg-gradient-to-tr from-blue-500 via-cyan-500 to-teal-400 text-white';
    case 'PUT': return 'bg-yellow-100 text-yellow-800';
    case 'DELETE': return 'bg-red-100 text-red-800';
    default: return 'bg-gray-100 text-gray-800';
  }
};

  const toggleRowExpansion = (logId: number) => {
    setExpandedRows(prev => ({
      ...prev,
      [logId]: !prev[logId]
    }));
  };

  const formatJson = (jsonString: string) => {
    try {
      const parsed = JSON.parse(jsonString);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return jsonString;
    }
  };

  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Hook Endpoint Logs</h2>
        <p className="text-gray-600">
          View access logs for {HOOK_ENDPOINTS.join(' & ')}
        </p>
        <button
          onClick={fetchLogs}
          className="mt-2 px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600"
        >
          Refresh Logs
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white p-4 rounded-lg shadow-sm mb-6">
        <h3 className="text-lg font-semibold mb-4">Filters</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Endpoint</label>
            <select
              value={filters.endpoint}
              onChange={(e) => setFilters(prev => ({ ...prev, endpoint: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Hook Endpoints</option>
              {HOOK_ENDPOINTS.map(endpoint => (
                <option key={endpoint} value={endpoint}>{endpoint}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Search Request Body</label>
            <input
              type="text"
              value={filters.searchTerm}
              onChange={(e) => setFilters(prev => ({ ...prev, searchTerm: e.target.value }))}
              placeholder="Search request body..."
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Response Code</label>
            <select
              value={filters.responseCode}
              onChange={(e) => setFilters(prev => ({ ...prev, responseCode: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Codes</option>
              {availableResponseCodes.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">From Date</label>
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(e) => setFilters(prev => ({ ...prev, dateFrom: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">To Date</label>
            <input
              type="date"
              value={filters.dateTo}
              onChange={(e) => setFilters(prev => ({ ...prev, dateTo: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          
          <div className="flex items-end">
            <button
              onClick={() => setFilters({
                endpoint: '',
                responseCode: '',
                searchTerm: '',
                dateFrom: '',
                dateTo: ''
              })}
              className="w-full px-4 py-2 bg-gray-500 text-white rounded-md hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-500"
            >
              Clear Filters
            </button>
          </div>
        </div>
      </div>

      {/* Logs Table */}
      <div className="bg-white rounded-lg shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center">
            <div className="loading loading-spinner loading-lg text-primary"></div>
            <p className="mt-2 text-gray-600">Loading access logs...</p>
          </div>
        ) : error ? (
          <div className="p-8 text-center">
            <p className="text-red-600">{error}</p>
            <button
              onClick={fetchLogs}
              className="mt-2 px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600"
            >
              Retry
            </button>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                                 <thead className="bg-gray-50">
                   <tr>
                     <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                       Date Created
                     </th>
                     <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                       Method
                     </th>
                     <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                       Endpoint
                     </th>
                     <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                       Request Body
                     </th>
                     <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                       Response Code
                     </th>
                   </tr>
                 </thead>
                                 <tbody className="bg-white divide-y divide-gray-200">
                   {logs.map((log) => (
                     <React.Fragment key={log.id}>
                       <tr 
                         className="hover:bg-gray-50 cursor-pointer"
                         onClick={() => toggleRowExpansion(log.id)}
                       >
                         <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                           <div className="flex flex-col space-y-1">
                             <div className="flex items-center space-x-2">
                               <CalendarIcon className="w-4 h-4 text-gray-500" />
                               <span>{formatDate(log.created_at).date}</span>
                             </div>
                             <div className="flex items-center space-x-2">
                               <ClockIcon className="w-4 h-4 text-gray-500" />
                               <span>{formatDate(log.created_at).time}</span>
                             </div>
                           </div>
                         </td>
                         <td className="px-6 py-4 whitespace-nowrap">
                           <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getMethodColor(log.request_method)}`}>
                             {log.request_method}
                           </span>
                         </td>
                         <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-mono">
                           {log.endpoint}
                         </td>
                        <td className="px-6 py-4 text-sm text-gray-900 max-w-3xl">
                          <pre className="text-xs overflow-x-auto whitespace-pre-wrap">
                            {log.request_body ? formatJson(log.request_body) : 'No request body'}
                          </pre>
                         </td>
                         <td className="px-6 py-4 whitespace-nowrap">
                           <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getResponseCodeColor(log.response_code)}`}>
                             {log.response_code}
                           </span>
                         </td>
                       </tr>
                      {expandedRows[log.id] && (
                        <tr className="bg-white">
                           <td colSpan={5} className="px-6 py-4">
                             <div className="space-y-2">
                               <h4 className="font-semibold text-sm text-gray-700">Response Body:</h4>
                               <pre className="text-xs bg-white p-3 rounded border overflow-x-auto whitespace-pre-wrap max-h-96 overflow-y-auto">
                                 {log.response_body ? formatJson(log.response_body) : 'No response body'}
                               </pre>
                             </div>
                           </td>
                         </tr>
                       )}
                     </React.Fragment>
                   ))}
                 </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="bg-white px-4 py-3 flex items-center justify-between border-t border-gray-200 sm:px-6">
                <div className="flex-1 flex justify-between sm:hidden">
                  <button
                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                    disabled={currentPage === 1}
                    className="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                    disabled={currentPage === totalPages}
                    className="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
                <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm text-gray-700">
                      Showing page <span className="font-medium">{currentPage}</span> of{' '}
                      <span className="font-medium">{totalPages}</span>
                    </p>
                  </div>
                  <div>
                    <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px">
                      <button
                        onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                        disabled={currentPage === 1}
                        className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                      >
                        Previous
                      </button>
                      <button
                        onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                        disabled={currentPage === totalPages}
                        className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                      >
                        Next
                      </button>
                    </nav>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default AccessLogsManager; 