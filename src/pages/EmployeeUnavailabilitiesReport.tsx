import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { toast } from 'react-hot-toast';
import * as XLSX from 'xlsx';
import { 
  MagnifyingGlassIcon, 
  DocumentTextIcon,
  DocumentArrowUpIcon,
  CalendarIcon,
  UserIcon,
  ArrowDownTrayIcon
} from '@heroicons/react/24/outline';
import { usePersistedFilters } from '../hooks/usePersistedState';
import DocumentViewerModal from '../components/DocumentViewerModal';

interface EmployeeUnavailabilityData {
  employeeId: number;
  employeeName: string;
  photoUrl?: string | null;
  departmentName?: string | null;
  sickDays: number;
  vacationDays: number;
  generalDays: number;
  hasDocuments: boolean;
}

interface DocumentData {
  id: number;
  employeeId: number;
  employeeName: string;
  documentUrl: string;
  uploadedAt: string;
  sickDaysReason: string;
  startDate: string;
  endDate: string | null;
}

const EmployeeUnavailabilitiesReport = () => {
  const navigate = useNavigate();
  const [filters, setFilters] = usePersistedFilters('employee_unavailabilities_filters', {
    fromDate: '',
    toDate: '',
    searchTerm: '',
  }, {
    storage: 'sessionStorage',
  });

  const [loading, setLoading] = useState(false);
  const [employeeData, setEmployeeData] = useState<EmployeeUnavailabilityData[]>([]);
  const [documents, setDocuments] = useState<DocumentData[]>([]);
  const [allEmployees, setAllEmployees] = useState<any[]>([]);
  const [selectedDocument, setSelectedDocument] = useState<DocumentData | null>(null);
  const [isDocumentModalOpen, setIsDocumentModalOpen] = useState(false);

  // Fetch employees for search
  useEffect(() => {
    const fetchEmployees = async () => {
      try {
        const { data, error } = await supabase
          .from('tenants_employee')
          .select('id, display_name, photo_url')
          .order('display_name', { ascending: true });

        if (error) throw error;
        setAllEmployees(data || []);
      } catch (error) {
        console.error('Error fetching employees:', error);
      }
    };

    fetchEmployees();
  }, []);

  // Fetch unavailability data
  const fetchData = async () => {
    if (!filters.fromDate || !filters.toDate) {
      toast.error('Please select both from and to dates');
      return;
    }

    setLoading(true);
    try {
      // Fetch all unavailability reasons that overlap with the date range
      // We'll fetch all records and filter in JavaScript for better control
      const { data: reasonsData, error: reasonsError } = await supabase
        .from('employee_unavailability_reasons')
        .select(`
          id,
          employee_id,
          unavailability_type,
          sick_days_reason,
          vacation_reason,
          general_reason,
          document_url,
          start_date,
          end_date,
          created_at,
          tenants_employee!employee_id(
            id,
            display_name,
            photo_url,
            department_id,
            tenant_departement!department_id(
              id,
              name
            )
          )
        `)
        .order('start_date', { ascending: false });

      if (reasonsError) throw reasonsError;

      // Filter records that overlap with the date range
      const filteredReasons = (reasonsData || []).filter((reason: any) => {
        const startDate = new Date(reason.start_date);
        const endDate = reason.end_date ? new Date(reason.end_date) : startDate;
        const filterFromDate = new Date(filters.fromDate);
        const filterToDate = new Date(filters.toDate);

        // Check if ranges overlap: start <= filterTo AND end >= filterFrom
        return startDate <= filterToDate && endDate >= filterFromDate;
      });

      if (reasonsError) throw reasonsError;

      // Process data by employee
      const employeeMap = new Map<number, EmployeeUnavailabilityData>();
      const documentsList: DocumentData[] = [];

      filteredReasons.forEach((reason: any) => {
        const employee = reason.tenants_employee;
        if (!employee) return;

        const employeeId = reason.employee_id;
        const employeeData = Array.isArray(employee) ? employee[0] : employee;
        const employeeName = employeeData?.display_name;
        const photoUrl = employeeData?.photo_url;
        const department = employeeData?.tenant_departement;
        const departmentName = department 
          ? (Array.isArray(department) ? department[0]?.name : department?.name)
          : null;

        if (!employeeMap.has(employeeId)) {
          employeeMap.set(employeeId, {
            employeeId,
            employeeName: employeeName || 'Unknown',
            photoUrl,
            departmentName: departmentName || '—',
            sickDays: 0,
            vacationDays: 0,
            generalDays: 0,
            hasDocuments: false,
          });
        }

        const empData = employeeMap.get(employeeId)!;

        // Calculate days for this entry within the filter period
        const startDate = new Date(reason.start_date);
        const endDate = reason.end_date ? new Date(reason.end_date) : startDate;
        const filterFromDate = new Date(filters.fromDate);
        const filterToDate = new Date(filters.toDate);
        
        // Calculate the overlap: use the later of start dates and earlier of end dates
        const overlapStart = startDate > filterFromDate ? startDate : filterFromDate;
        const overlapEnd = endDate < filterToDate ? endDate : filterToDate;
        const daysDiff = Math.ceil((overlapEnd.getTime() - overlapStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;

        if (reason.unavailability_type === 'sick_days') {
          empData.sickDays += daysDiff;
          if (reason.document_url) {
            empData.hasDocuments = true;
            documentsList.push({
              id: reason.id,
              employeeId,
              employeeName: employeeName || 'Unknown',
              documentUrl: reason.document_url,
              uploadedAt: reason.created_at,
              sickDaysReason: reason.sick_days_reason || '',
              startDate: reason.start_date,
              endDate: reason.end_date,
            });
          }
        } else if (reason.unavailability_type === 'vacation') {
          empData.vacationDays += daysDiff;
        } else if (reason.unavailability_type === 'general') {
          empData.generalDays += daysDiff;
        }
      });

      // Filter by search term
      let filteredData = Array.from(employeeMap.values());
      if (filters.searchTerm.trim()) {
        const searchLower = filters.searchTerm.toLowerCase();
        filteredData = filteredData.filter(emp => 
          emp.employeeName.toLowerCase().includes(searchLower)
        );
      }

      setEmployeeData(filteredData);
      setDocuments(documentsList);
    } catch (error) {
      console.error('Error fetching unavailability data:', error);
      toast.error('Failed to load unavailability data');
    } finally {
      setLoading(false);
    }
  };

  // Auto-fetch when dates are set
  useEffect(() => {
    if (filters.fromDate && filters.toDate) {
      fetchData();
    }
  }, [filters.fromDate, filters.toDate]);

  const handleFilterChange = (field: string, value: any) => {
    setFilters(prev => ({ ...prev, [field]: value }));
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  // Export employee summary to Excel
  const exportEmployeeSummary = () => {
    if (employeeData.length === 0) {
      toast.error('No data to export');
      return;
    }

    const excelData = employeeData.map(emp => ({
      'Employee': emp.employeeName,
      'Department': emp.departmentName || '—',
      'Sick Days': emp.sickDays,
      'Vacation': emp.vacationDays,
      'General': emp.generalDays
    }));

    const ws = XLSX.utils.json_to_sheet(excelData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Employee Summary');

    const dateStr = new Date().toISOString().split('T')[0];
    const fromDateStr = filters.fromDate ? new Date(filters.fromDate).toISOString().split('T')[0] : '';
    const toDateStr = filters.toDate ? new Date(filters.toDate).toISOString().split('T')[0] : '';
    const dateRange = fromDateStr && toDateStr ? `_${fromDateStr}_to_${toDateStr}` : '';
    
    XLSX.writeFile(wb, `Employee_Unavailabilities_Summary${dateRange}_${dateStr}.xlsx`);
    toast.success('Employee summary exported successfully');
  };

  const formatDateTime = (dateString: string) => {
    return new Date(dateString).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getDocumentName = (documentUrl: string): string => {
    try {
      // Extract filename from URL
      let filename = '';
      if (documentUrl.includes('?')) {
        filename = documentUrl.split('?')[0].split('/').pop() || '';
      } else {
        const parts = documentUrl.split('/');
        filename = parts[parts.length - 1];
      }
      
      // If filename is empty, return default
      if (!filename) return 'document';
      
      // Extract file extension
      const ext = filename.split('.').pop() || '';
      
      // If the filename follows the pattern employee_ID_timestamp_random.ext,
      // show a cleaner name with the extension
      if (filename.startsWith('employee_') && filename.includes('_')) {
        return `Document.${ext}`;
      }
      
      // Otherwise return the filename as is
      return filename;
    } catch (error) {
      // If URL parsing fails, try to extract from string
      const parts = documentUrl.split('/');
      const filename = parts[parts.length - 1] || 'document';
      return filename.split('?')[0]; // Remove query params if any
    }
  };

  // Filter documents by search term
  const filteredDocuments = useMemo(() => {
    if (!filters.searchTerm.trim()) return documents;
    const searchLower = filters.searchTerm.toLowerCase();
    return documents.filter(doc => 
      doc.employeeName.toLowerCase().includes(searchLower)
    );
  }, [documents, filters.searchTerm]);

  return (
    <div className="p-0 md:p-6 space-y-8">
      <div className="mb-6">
        <button
          onClick={() => navigate('/reports')}
          className="btn btn-ghost btn-sm mb-4"
        >
          ← Back to Reports
        </button>
        <h1 className="text-3xl font-bold mb-6">Employee Unavailabilities Report</h1>

        {/* Filters */}
        <div className="card bg-base-100 shadow-lg p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="label">
                <span className="label-text">From Date</span>
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
                <span className="label-text">To Date</span>
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
                <span className="label-text">Search Employee</span>
              </label>
              <div className="relative">
                <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  className="input input-bordered w-full pl-10"
                  placeholder="Search by employee name..."
                  value={filters.searchTerm}
                  onChange={(e) => handleFilterChange('searchTerm', e.target.value)}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Employee Table */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">Employee Summary</h2>
            <button
              onClick={exportEmployeeSummary}
              className="btn btn-sm btn-primary"
              disabled={loading || employeeData.length === 0}
              title="Download as Excel"
            >
              <ArrowDownTrayIcon className="w-5 h-5 mr-2" />
              Export to Excel
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="table w-full">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Department</th>
                  <th className="text-right">Sick Days</th>
                  <th className="text-right">Vacation</th>
                  <th className="text-right">General</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} className="text-center py-8">
                      <span className="loading loading-spinner loading-md"></span>
                      <span className="ml-2">Loading...</span>
                    </td>
                  </tr>
                ) : employeeData.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center py-8 text-gray-500">
                      No data found for the selected period
                    </td>
                  </tr>
                ) : (
                  employeeData.map((emp) => (
                    <tr key={emp.employeeId} className="hover:bg-base-200">
                      <td>
                        <div className="flex items-center gap-3">
                          {emp.photoUrl ? (
                            <img
                              src={emp.photoUrl}
                              alt={emp.employeeName}
                              className="w-10 h-10 rounded-full object-cover"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                              <UserIcon className="w-6 h-6 text-primary" />
                            </div>
                          )}
                          <span className="font-medium">{emp.employeeName}</span>
                        </div>
                      </td>
                      <td>
                        <span className="text-gray-600">{emp.departmentName || '—'}</span>
                      </td>
                      <td className="text-right font-semibold">{emp.sickDays}</td>
                      <td className="text-right font-semibold">{emp.vacationDays}</td>
                      <td className="text-right font-semibold">{emp.generalDays}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Documents Section */}
        <div>
          <h2 className="text-xl font-semibold mb-4">Uploaded Documents</h2>
          {loading ? (
            <div className="text-center py-8">
              <span className="loading loading-spinner loading-md"></span>
              <span className="ml-2">Loading...</span>
            </div>
          ) : filteredDocuments.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              No documents uploaded for the selected period
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table w-full">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Document</th>
                    <th>Reason</th>
                    <th>Date Range</th>
                    <th>Uploaded At</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDocuments.map((doc) => (
                    <tr key={doc.id} className="hover:bg-base-200">
                      <td>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{doc.employeeName}</span>
                        </div>
                      </td>
                      <td>
                        <div className="flex items-center gap-2">
                          <DocumentArrowUpIcon className="w-5 h-5 text-primary" />
                          <span className="text-sm font-medium">{getDocumentName(doc.documentUrl)}</span>
                        </div>
                      </td>
                      <td>
                        <span className="text-sm">{doc.sickDaysReason || '—'}</span>
                      </td>
                      <td>
                        <span className="text-sm">
                          {formatDate(doc.startDate)}
                          {doc.endDate && doc.endDate !== doc.startDate && (
                            <> - {formatDate(doc.endDate)}</>
                          )}
                        </span>
                      </td>
                      <td>
                        <span className="text-sm text-gray-600">
                          {formatDateTime(doc.uploadedAt)}
                        </span>
                      </td>
                      <td>
                        <button
                          onClick={() => {
                            setSelectedDocument(doc);
                            setIsDocumentModalOpen(true);
                          }}
                          className="btn btn-xs btn-primary"
                        >
                          View Document
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Document Viewer Modal */}
      {selectedDocument && (
        <DocumentViewerModal
          isOpen={isDocumentModalOpen}
          onClose={() => {
            setIsDocumentModalOpen(false);
            setSelectedDocument(null);
          }}
          documentUrl={selectedDocument.documentUrl}
          documentName={getDocumentName(selectedDocument.documentUrl)}
          employeeName={selectedDocument.employeeName}
          uploadedAt={selectedDocument.uploadedAt}
          sickDaysReason={selectedDocument.sickDaysReason}
        />
      )}
    </div>
  );
};

export default EmployeeUnavailabilitiesReport;
