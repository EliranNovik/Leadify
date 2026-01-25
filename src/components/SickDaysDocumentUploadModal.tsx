import React, { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { XMarkIcon, DocumentArrowUpIcon, DocumentIcon, CheckCircleIcon, XCircleIcon, EyeIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import DocumentViewerModal from './DocumentViewerModal';

interface SickDayRecord {
  id: number;
  start_date: string;
  end_date: string | null;
  sick_days_reason: string | null;
  document_url: string | null;
  created_at: string;
}

interface SickDaysDocumentUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDocumentUploaded?: () => void;
}

const SickDaysDocumentUploadModal: React.FC<SickDaysDocumentUploadModalProps> = ({
  isOpen,
  onClose,
  onDocumentUploaded
}) => {
  const [sickDays, setSickDays] = useState<SickDayRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedSickDay, setSelectedSickDay] = useState<SickDayRecord | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [currentEmployeeId, setCurrentEmployeeId] = useState<number | null>(null);
  const [uploadFilter, setUploadFilter] = useState<'all' | 'uploaded' | 'not_uploaded'>('all');
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [isViewerOpen, setIsViewerOpen] = useState(false);
  const [selectedDocument, setSelectedDocument] = useState<{ url: string; name: string; reason: string | null; uploadedAt: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch current employee ID (same pattern as CompactAvailabilityCalendar)
  useEffect(() => {
    const fetchEmployeeId = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user?.id) {
          console.log('⚠️ No auth user found');
          return;
        }

        // Get user data with employee_id (same as CompactAvailabilityCalendar)
        let userEmployeeId: number | null = null;
        let userDisplayName: string | null = null;
        
        const { data: userData, error: userError } = await supabase
          .from('users')
          .select(`
            full_name,
            employee_id,
            tenants_employee!employee_id(
              id,
              display_name
            )
          `)
          .eq('auth_id', user.id)
          .single();

        if (userError || !userData) {
          console.error('❌ Error getting user data:', userError);
          // Try fallback by email
          if (user.email) {
            const { data: userByEmail } = await supabase
              .from('users')
              .select(`
                full_name,
                employee_id,
                tenants_employee!employee_id(
                  id,
                  display_name
                )
              `)
              .eq('email', user.email)
              .maybeSingle();
            
            if (userByEmail?.employee_id && typeof userByEmail.employee_id === 'number') {
              console.log('✅ Found employee_id from email fallback:', userByEmail.employee_id);
              setCurrentEmployeeId(userByEmail.employee_id);
              return;
            }
          }
          return;
        }

        // Get employee_id from users table if available
        if (userData?.employee_id && typeof userData.employee_id === 'number') {
          userEmployeeId = userData.employee_id;
          console.log('✅ Found employee_id from users table:', userEmployeeId);
          setCurrentEmployeeId(userEmployeeId);
          return;
        }
        
        // Get display name from employee relationship or fallback to full_name
        if (userData?.tenants_employee) {
          const empData = Array.isArray(userData.tenants_employee) 
            ? userData.tenants_employee[0] 
            : userData.tenants_employee;
          if (empData?.display_name) {
            userDisplayName = empData.display_name;
          }
        }
        
        if (!userDisplayName && userData?.full_name) {
          userDisplayName = userData.full_name;
        }

        // Fallback: get employee_id from tenants_employee by display_name
        if (userDisplayName) {
          const { data: employeeData, error: empError } = await supabase
            .from('tenants_employee')
            .select('id')
            .eq('display_name', userDisplayName)
            .maybeSingle();

          if (empError) {
            console.error('❌ Error fetching employee by display_name:', empError);
            return;
          }

          if (employeeData?.id) {
            console.log('✅ Found employee_id from tenants_employee by display_name:', employeeData.id);
            setCurrentEmployeeId(employeeData.id);
          } else {
            console.log('⚠️ No employee found with display_name:', userDisplayName);
          }
        } else {
          console.log('⚠️ No display_name available');
        }
      } catch (error) {
        console.error('❌ Error fetching employee ID:', error);
      }
    };

    if (isOpen) {
      fetchEmployeeId();
    }
  }, [isOpen]);

  // Fetch sick days
  useEffect(() => {
    const fetchSickDays = async () => {
      if (!isOpen || !currentEmployeeId) {
        if (isOpen && !currentEmployeeId) {
          console.log('⚠️ Cannot fetch sick days: employee_id not available yet');
        }
        return;
      }

      setLoading(true);
      try {
        console.log('🔍 Fetching sick days for employee_id:', currentEmployeeId);
        const { data, error } = await supabase
          .from('employee_unavailability_reasons')
          .select('id, start_date, end_date, sick_days_reason, document_url, created_at')
          .eq('employee_id', currentEmployeeId)
          .eq('unavailability_type', 'sick_days')
          .order('start_date', { ascending: false });

        if (error) {
          console.error('❌ Error fetching sick days:', error);
          toast.error('Failed to fetch sick days');
          return;
        }

        console.log('✅ Fetched sick days:', data?.length || 0, 'records');
        setSickDays(data || []);
      } catch (error) {
        console.error('❌ Error fetching sick days:', error);
        toast.error('Failed to fetch sick days');
      } finally {
        setLoading(false);
      }
    };

    if (isOpen && currentEmployeeId) {
      fetchSickDays();
    }
  }, [isOpen, currentEmployeeId]);

  // Format date range
  const formatDateRange = (startDate: string, endDate: string | null): string => {
    const start = new Date(startDate);
    const startStr = start.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
    
    if (!endDate || endDate === startDate) {
      return startStr;
    }
    
    const end = new Date(endDate);
    const endStr = end.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
    return `${startStr} - ${endStr}`;
  };

  // Get document name from URL
  const getDocumentName = (url: string | null): string => {
    if (!url) return '';
    // Extract filename from path
    const parts = url.split('/');
    return parts[parts.length - 1] || url;
  };

  // Filter sick days based on upload status and date range
  const filteredSickDays = useMemo(() => {
    let filtered = [...sickDays];

    // Filter by upload status
    if (uploadFilter === 'uploaded') {
      filtered = filtered.filter(day => day.document_url !== null);
    } else if (uploadFilter === 'not_uploaded') {
      filtered = filtered.filter(day => day.document_url === null);
    }

    // Filter by date range
    if (fromDate) {
      filtered = filtered.filter(day => {
        const dayDate = new Date(day.start_date);
        return dayDate >= new Date(fromDate);
      });
    }

    if (toDate) {
      filtered = filtered.filter(day => {
        const dayDate = new Date(day.start_date);
        const endDate = day.end_date ? new Date(day.end_date) : dayDate;
        return endDate <= new Date(toDate);
      });
    }

    return filtered;
  }, [sickDays, uploadFilter, fromDate, toDate]);

  // Handle file selection
  const handleFileSelect = (file: File) => {
    const allowedTypes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/webp',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];

    if (!allowedTypes.includes(file.type)) {
      toast.error('Invalid file type. Please upload images or documents (PDF, Word)');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast.error('File size must be less than 10MB');
      return;
    }

    setSelectedFile(file);
  };

  // Upload document
  const uploadDocument = async (file: File): Promise<string | null> => {
    if (!currentEmployeeId) {
      toast.error('Employee ID not found');
      return null;
    }

    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `employee_${currentEmployeeId}_${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
      
      const { data, error } = await supabase.storage
        .from('employee-unavailability-documents')
        .upload(fileName, file, {
          cacheControl: '3600',
          upsert: false,
          contentType: file.type
        });

      if (error) {
        console.error('Error uploading document:', error);
        toast.error('Failed to upload document');
        return null;
      }

      return fileName;
    } catch (error) {
      console.error('Error uploading document:', error);
      toast.error('Failed to upload document');
      return null;
    }
  };

  // Save document to sick day record
  const handleUploadDocument = async () => {
    if (!selectedSickDay || !selectedFile) {
      toast.error('Please select a sick day and a document');
      return;
    }

    setUploading(true);
    try {
      const filePath = await uploadDocument(selectedFile);
      
      if (!filePath) {
        return;
      }

      // Update the sick day record with the document URL
      const { error } = await supabase
        .from('employee_unavailability_reasons')
        .update({ document_url: filePath })
        .eq('id', selectedSickDay.id);

      if (error) {
        console.error('Error updating sick day record:', error);
        toast.error('Failed to save document');
        return;
      }

      toast.success('Document uploaded successfully');
      
      // Refresh sick days list
      const { data } = await supabase
        .from('employee_unavailability_reasons')
        .select('id, start_date, end_date, sick_days_reason, document_url, created_at')
        .eq('employee_id', currentEmployeeId)
        .eq('unavailability_type', 'sick_days')
        .order('start_date', { ascending: false });

      if (data) {
        setSickDays(data);
      }

      // Reset selection
      setSelectedSickDay(null);
      setSelectedFile(null);

      // Notify parent component
      if (onDocumentUploaded) {
        onDocumentUploaded();
      }
    } catch (error) {
      console.error('Error uploading document:', error);
      toast.error('Failed to upload document');
    } finally {
      setUploading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white rounded-lg p-6 max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Upload Documents for Sick Days</h3>
          <button
            onClick={() => {
              onClose();
              setSelectedSickDay(null);
              setSelectedFile(null);
            }}
            className="btn btn-ghost btn-sm btn-circle"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center items-center py-12">
            <span className="loading loading-spinner loading-lg text-primary"></span>
          </div>
        ) : sickDays.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <p className="text-lg font-medium mb-2">No sick days recorded</p>
            <p className="text-sm">You don't have any sick days recorded yet.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Filters */}
            <div className="rounded-lg p-4 space-y-4 border border-gray-200">
              {/* Upload Status Filter */}
              <div>
                <label className="label">
                  <span className="label-text font-semibold">Filter by Upload Status</span>
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setUploadFilter('all')}
                    className={`btn btn-sm ${uploadFilter === 'all' ? 'btn-primary' : 'btn-ghost'}`}
                  >
                    All
                  </button>
                  <button
                    onClick={() => setUploadFilter('uploaded')}
                    className={`btn btn-sm ${uploadFilter === 'uploaded' ? 'btn-primary' : 'btn-ghost'}`}
                  >
                    Uploaded
                  </button>
                  <button
                    onClick={() => setUploadFilter('not_uploaded')}
                    className={`btn btn-sm ${uploadFilter === 'not_uploaded' ? 'btn-primary' : 'btn-ghost'}`}
                  >
                    Not Uploaded
                  </button>
                </div>
              </div>

              {/* Date Range Filter */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="label">
                    <span className="label-text font-semibold">From Date</span>
                  </label>
                  <input
                    type="date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    className="input input-bordered w-full"
                  />
                </div>
                <div>
                  <label className="label">
                    <span className="label-text font-semibold">To Date</span>
                  </label>
                  <input
                    type="date"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                    className="input input-bordered w-full"
                  />
                </div>
              </div>
            </div>

            {/* Sick Days Grid */}
            {filteredSickDays.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <p className="text-sm">No sick days match the selected filters.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
                {filteredSickDays.map((sickDay) => (
                  <div
                    key={sickDay.id}
                    onClick={() => {
                      setSelectedSickDay(sickDay);
                      setSelectedFile(null);
                    }}
                    className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                      selectedSickDay?.id === sickDay.id
                        ? 'border-primary bg-primary/5'
                        : 'border-gray-200 hover:border-gray-300 bg-white'
                    }`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <div className="font-semibold text-gray-900 mb-1">
                          {formatDateRange(sickDay.start_date, sickDay.end_date)}
                        </div>
                        {sickDay.sick_days_reason && (
                          <div className="text-sm text-gray-600 mb-2">
                            {sickDay.sick_days_reason}
                          </div>
                        )}
                      </div>
                      {sickDay.document_url ? (
                        <CheckCircleIcon className="w-5 h-5 text-green-500 flex-shrink-0 ml-2" />
                      ) : (
                        <XCircleIcon className="w-5 h-5 text-red-500 flex-shrink-0 ml-2" />
                      )}
                    </div>
                    {sickDay.document_url ? (
                      <div className="text-xs text-gray-500 mt-2 flex items-center gap-1">
                        <DocumentIcon className="w-3 h-3" />
                        <span className="truncate">{getDocumentName(sickDay.document_url)}</span>
                      </div>
                    ) : (
                      <div className="text-xs text-red-500 mt-2 flex items-center gap-1">
                        <span>Click to upload document</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Upload Section */}
            {selectedSickDay && (
              <div className="border-t pt-4">
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-semibold text-gray-900">
                      Selected: {formatDateRange(selectedSickDay.start_date, selectedSickDay.end_date)}
                    </h4>
                    {selectedSickDay.document_url && (
                      <button
                        onClick={() => {
                          setSelectedDocument({
                            url: selectedSickDay.document_url!,
                            name: getDocumentName(selectedSickDay.document_url!),
                            reason: selectedSickDay.sick_days_reason,
                            uploadedAt: selectedSickDay.created_at
                          });
                          setIsViewerOpen(true);
                        }}
                        className="btn btn-sm btn-ghost text-primary hover:text-primary-focus"
                        title="View Document"
                      >
                        <EyeIcon className="w-4 h-4 mr-1" />
                        View Document
                      </button>
                    )}
                  </div>
                  {selectedSickDay.sick_days_reason && (
                    <p className="text-sm text-gray-600">Reason: {selectedSickDay.sick_days_reason}</p>
                  )}
                </div>

                <div>
                  <label className="label">
                    <span className="label-text">
                      Upload Document
                      {selectedSickDay.document_url && (
                        <span className="text-xs text-gray-500 ml-2">(will replace existing document)</span>
                      )}
                    </span>
                  </label>
                  <div
                    className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
                      selectedFile
                        ? 'border-primary bg-primary/5'
                        : 'border-gray-300 hover:border-primary/50 cursor-pointer'
                    }`}
                    onClick={() => {
                      if (!selectedFile && fileInputRef.current) {
                        fileInputRef.current.click();
                      }
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const file = e.dataTransfer.files[0];
                      if (file) {
                        handleFileSelect(file);
                      }
                    }}
                  >
                    {selectedFile ? (
                      <div className="space-y-2">
                        <DocumentArrowUpIcon className="w-8 h-8 mx-auto text-primary" />
                        <p className="text-sm font-medium text-gray-700">{selectedFile.name}</p>
                        <button
                          type="button"
                          className="btn btn-xs btn-ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedFile(null);
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <DocumentIcon className="w-8 h-8 mx-auto text-gray-400" />
                        <p className="text-sm text-gray-600">
                          Drag and drop a document here, or click anywhere to browse
                        </p>
                        <p className="text-xs text-gray-500">PDF, Word, or Images (max 10MB)</p>
                        <p className="text-xs text-primary font-medium mt-2">Click to upload document</p>
                      </div>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      className="hidden"
                      accept="image/*,.pdf,.doc,.docx"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          handleFileSelect(file);
                        }
                      }}
                    />
                  </div>
                </div>

                <div className="flex gap-2 justify-end mt-4">
                  <button
                    className="btn btn-ghost"
                    onClick={() => {
                      setSelectedSickDay(null);
                      setSelectedFile(null);
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={handleUploadDocument}
                    disabled={uploading || !selectedFile}
                  >
                    {uploading ? 'Uploading...' : 'Upload Document'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Document Viewer Modal */}
      {selectedDocument && (
        <DocumentViewerModal
          isOpen={isViewerOpen}
          onClose={() => {
            setIsViewerOpen(false);
            setSelectedDocument(null);
          }}
          documentUrl={selectedDocument.url}
          documentName={selectedDocument.name}
          uploadedAt={selectedDocument.uploadedAt}
          sickDaysReason={selectedDocument.reason || undefined}
        />
      )}
    </div>
  );
};

export default SickDaysDocumentUploadModal;
