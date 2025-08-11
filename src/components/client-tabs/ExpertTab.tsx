import React, { useState, useEffect } from 'react';
import { ClientTabProps } from '../../types/client';
import TimelineHistoryButtons from './TimelineHistoryButtons';
import { 
  AcademicCapIcon, 
  ShareIcon, 
  PencilSquareIcon, 
  DocumentArrowUpIcon,
  PaperClipIcon,
  HashtagIcon,
  CheckIcon,
  XMarkIcon,
  ClockIcon,
  CheckCircleIcon,
  MagnifyingGlassIcon,
  XCircleIcon
} from '@heroicons/react/24/outline';
import { FolderIcon } from '@heroicons/react/24/solid';
import { supabase } from '../../lib/supabase';
import DocumentModal from '../DocumentModal';

interface UploadedFile {
  name: string;
  status: 'uploading' | 'success' | 'error';
  progress?: number;
  error?: string;
}

interface Note {
  id: string;
  content: string;
  timestamp: string;
}

interface EligibilityOption {
  value: string;
  label: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  color: string;
}

interface EligibilityStatus {
  value: string;
  timestamp: string;
}

const ExpertTab: React.FC<ClientTabProps> = ({ client, onClientUpdate }) => {
  // Helper function to get current user's full name
  const getCurrentUserName = async (): Promise<string> => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) return 'Unknown';
      
      // Get user's full name from users table
      const { data: userData, error } = await supabase
        .from('users')
        .select('full_name')
        .eq('auth_id', user.id)
        .single();
      
      if (error || !userData?.full_name) {
        return user?.email || 'Unknown';
      }
      
      return userData.full_name;
    } catch (error) {
      console.error('Error getting user name:', error);
      return 'Unknown';
    }
  };

  // Section & eligibility
  const [selectedSection, setSelectedSection] = useState(client.section_eligibility || '');
  const [eligibilityStatus, setEligibilityStatus] = useState<EligibilityStatus>({
    value: client.eligibility_status || '',
    timestamp: client.eligibility_status_timestamp || ''
  });

  // Expert Notes
  const [expertNotes, setExpertNotes] = useState<Note[]>(client.expert_notes || []);
  const [isAddingExpertNote, setIsAddingExpertNote] = useState(false);
  const [editingExpertNoteId, setEditingExpertNoteId] = useState<string | null>(null);
  const [newExpertNoteContent, setNewExpertNoteContent] = useState('');

  // Handler Notes
  const [handlerNotes, setHandlerNotes] = useState<Note[]>(client.handler_notes || []);
  const [isAddingHandlerNote, setIsAddingHandlerNote] = useState(false);
  const [editingHandlerNoteId, setEditingHandlerNoteId] = useState<string | null>(null);
  const [newHandlerNoteContent, setNewHandlerNoteContent] = useState('');

  // File Upload State
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  // Document Modal State
  const [isDocumentModalOpen, setIsDocumentModalOpen] = useState(false);
  const [documentCount, setDocumentCount] = useState<number>(0);

  // Placeholder for document count and link
  const expertName = client.expert || 'Not assigned';
  const documentLink = client.onedrive_folder_link || '#';
  const hasDocumentLink = !!client.onedrive_folder_link;

  // I need an expert feature
  const [isAssigningExpert, setIsAssigningExpert] = useState(false);
  const handleAssignRandomExpert = async () => {
    setIsAssigningExpert(true);
    // Fetch all available experts from leads with a non-empty expert field
    const { data, error } = await supabase
      .from('leads')
      .select('expert')
      .not('expert', 'is', null)
      .neq('expert', '')
      .limit(100);
    if (error || !data || data.length === 0) {
      setIsAssigningExpert(false);
      alert('No available experts found.');
      return;
    }
    // Get unique expert names
    const experts = Array.from(new Set(data.map((row: any) => row.expert).filter(Boolean)));
    if (experts.length === 0) {
      setIsAssigningExpert(false);
      alert('No available experts found.');
      return;
    }
    // Pick one at random
    const randomExpert = experts[Math.floor(Math.random() * experts.length)];
    // Save to DB
    await supabase
      .from('leads')
      .update({ expert: randomExpert })
      .eq('id', client.id);
    setIsAssigningExpert(false);
    if (onClientUpdate) await onClientUpdate();
  };

  // Save section/eligibility to DB
  const handleSectionChange = async (value: string) => {
    setSelectedSection(value);
    await supabase
      .from('leads')
      .update({ section_eligibility: value })
      .eq('id', client.id);
    if (onClientUpdate) await onClientUpdate();
  };

  const handleEligibilityChange = async (newValue: string) => {
    const timestamp = new Date().toISOString();
    setEligibilityStatus({ value: newValue, timestamp });
    if (newValue === 'not_feasible') {
      setSelectedSection(''); // Clear section selection
    }
    
    // Only update expert assessment columns if this is the first time setting eligibility
    // or if the eligibility status is being changed from empty/null to a valid value
    const shouldUpdateExpertAssessment = !client.eligibility_status || client.eligibility_status === '';
    
    let updateData: any = {
      eligibility_status: newValue, 
      eligibility_status_timestamp: timestamp, 
      section_eligibility: newValue === 'not_feasible' ? '' : selectedSection
    };
    
    // Only update expert assessment columns when actually completing an assessment
    if (shouldUpdateExpertAssessment && newValue && newValue !== '') {
      const currentUser = await getCurrentUserName();
      
      updateData = {
        ...updateData,
        expert_eligibility_assessed: true,
        expert_eligibility_date: timestamp,
        expert_eligibility_assessed_by: currentUser
      };
    }
    
    await supabase
      .from('leads')
      .update(updateData)
      .eq('id', client.id);
    if (onClientUpdate) await onClientUpdate();
  };

  // Save expert notes to DB
  const handleSaveExpertNotes = async (notes: Note[]) => {
    setExpertNotes(notes);
    await supabase
      .from('leads')
      .update({ expert_notes: notes })
      .eq('id', client.id);
    if (onClientUpdate) await onClientUpdate();
  };

  // Save handler notes to DB
  const handleSaveHandlerNotes = async (notes: Note[]) => {
    setHandlerNotes(notes);
    await supabase
      .from('leads')
      .update({ handler_notes: notes })
      .eq('id', client.id);
    if (onClientUpdate) await onClientUpdate();
  };

  // Expert Notes logic
  const handleSaveExpertNote = async () => {
    let updatedNotes;
    if (editingExpertNoteId) {
      updatedNotes = expertNotes.map(note => 
        note.id === editingExpertNoteId 
          ? { ...note, content: newExpertNoteContent }
          : note
      );
      setEditingExpertNoteId(null);
    } else {
      const newNote: Note = {
        id: Date.now().toString(),
        content: newExpertNoteContent,
        timestamp: new Date().toLocaleString()
      };
      updatedNotes = [...expertNotes, newNote];
      setIsAddingExpertNote(false);
    }
    setNewExpertNoteContent('');
    await handleSaveExpertNotes(updatedNotes);
  };

  const handleEditExpertNote = (note: Note) => {
    setEditingExpertNoteId(note.id);
    setNewExpertNoteContent(note.content);
  };

  const handleCancelExpertEdit = () => {
    setEditingExpertNoteId(null);
    setNewExpertNoteContent('');
    setIsAddingExpertNote(false);
  };

  // Handler Notes logic
  const handleSaveHandlerNote = async () => {
    let updatedNotes;
    if (editingHandlerNoteId) {
      updatedNotes = handlerNotes.map(note => 
        note.id === editingHandlerNoteId 
          ? { ...note, content: newHandlerNoteContent }
          : note
      );
      setEditingHandlerNoteId(null);
    } else {
      const newNote: Note = {
        id: Date.now().toString(),
        content: newHandlerNoteContent,
        timestamp: new Date().toLocaleString()
      };
      updatedNotes = [...handlerNotes, newNote];
      setIsAddingHandlerNote(false);
    }
    setNewHandlerNoteContent('');
    await handleSaveHandlerNotes(updatedNotes);
  };

  const handleEditHandlerNote = (note: Note) => {
    setEditingHandlerNoteId(note.id);
    setNewHandlerNoteContent(note.content);
  };

  const handleCancelHandlerEdit = () => {
    setEditingHandlerNoteId(null);
    setNewHandlerNoteContent('');
    setIsAddingHandlerNote(false);
  };

  // Handle file drop
  const handleFileDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      await uploadFiles(Array.from(files));
    }
  };

  // Handle file input change
  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      await uploadFiles(Array.from(files));
    }
  };

  // The main upload function
  const uploadFiles = async (files: File[]) => {
    setIsUploading(true);
    const newUploads = files.map(file => ({ name: file.name, status: 'uploading' as const, progress: 0 }));
    setUploadedFiles(prev => [...prev, ...newUploads]);

    for (const file of files) {
      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('leadNumber', client.lead_number);

        const { data, error } = await supabase.functions.invoke('upload-to-onedrive', {
          body: formData,
        });

        if (error) throw new Error(error.message);
        if (!data || !data.success) {
          throw new Error(data.error || 'Upload function returned an error.');
        }

        const folderUrl = data.folderUrl;
        if (folderUrl && folderUrl !== client.onedrive_folder_link) {
            // Get current user for tracking who uploaded documents
            const currentUser = await getCurrentUserName();
            
            await supabase
                .from('leads')
                .update({ 
                    onedrive_folder_link: folderUrl,
                    // Update new AI notification columns
                    documents_uploaded_date: new Date().toISOString(),
                    documents_uploaded_by: currentUser
                })
                .eq('id', client.id);
            if (onClientUpdate) {
                await onClientUpdate();
            }
        }

        // Update file status to success
        setUploadedFiles(prev => prev.map(f => f.name === file.name ? { ...f, status: 'success', progress: 100 } : f));
        
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred';
        // Update file status to error
        setUploadedFiles(prev => prev.map(f => f.name === file.name ? { ...f, status: 'error', error: errorMessage } : f));
        console.error(`Error uploading ${file.name}:`, err);
      }
    }
    setIsUploading(false);
  };

  // Section/Eligibility options
  const sections = [
    { value: '116', label: 'German Citizenship - § 116', country: 'German' },
    { value: '15', label: 'German Citizenship - § 15', country: 'German' },
    { value: '5', label: 'German Citizenship - § 5', country: 'German' },
    { value: '58c', label: 'Austrian Citizenship - § 58c', country: 'Austrian' },
  ];

  const eligibilityOptions: EligibilityOption[] = [
    { 
      value: 'feasible_no_check', 
      label: 'Feasible (no check)', 
      icon: CheckCircleIcon,
      color: 'text-success'
    },
    { 
      value: 'feasible_check', 
      label: 'Feasible (further check)', 
      icon: MagnifyingGlassIcon,
      color: 'text-warning'
    },
    { 
      value: 'not_feasible', 
      label: 'No feasibility', 
      icon: XCircleIcon,
      color: 'text-error'
    }
  ];

  const selectedSectionLabel = sections.find(s => s.value === selectedSection)?.label.split(' - ')[1] || '';
  const selectedEligibilityLabel = eligibilityOptions.find(opt => opt.value === eligibilityStatus.value)?.label || '';
  const statusDisplay = eligibilityStatus.value === 'not_feasible'
    ? selectedEligibilityLabel || 'No feasibility'
    : (selectedSection && eligibilityStatus.value
      ? `${selectedSectionLabel} - ${selectedEligibilityLabel}`
      : 'Not checked');

  const selectedEligibility = eligibilityOptions.find(opt => opt.value === eligibilityStatus.value);

  // Function to update document count from DocumentModal
  const handleDocumentCountChange = (count: number) => {
    setDocumentCount(count);
  };

  return (
    <div className="p-2 sm:p-4 md:p-6 space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="p-2 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 rounded-lg">
          <AcademicCapIcon className="w-6 h-6 text-white" />
        </div>
        <div>
          <h2 className="text-2xl font-bold">Expert Assignment</h2>
          <p className="text-sm text-gray-500">Case evaluation and expert opinions</p>
        </div>
      </div>

      {/* Expert Information */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-200 overflow-hidden">
        <div className="pl-6 pt-2 pb-2 w-2/5">
          <h4 className="text-lg font-semibold text-black">Expert Information</h4>
          <div className="border-b border-gray-200 mt-2"></div>
        </div>
        <div className="p-6">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <label className="text-base font-medium text-gray-500 uppercase tracking-wide">Assigned Expert</label>
                <span className="text-2xl font-bold text-gray-900">{expertName}</span>
                {(!client.expert || client.expert === '---' || client.expert === 'Not assigned') && (
                  <button
                    className="btn btn-sm text-white border-none"
                    style={{ backgroundColor: '#3b28c7' }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#2d1b69'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#3b28c7'}
                    onClick={handleAssignRandomExpert}
                    disabled={isAssigningExpert}
                  >
                    {isAssigningExpert ? 'Assigning...' : 'I need an expert'}
                  </button>
                )}
              </div>
              <div className="space-y-2">
                <label className="text-base font-medium text-gray-500 uppercase tracking-wide">Eligibility Status</label>
                <span className={`inline-flex items-center px-3 py-1 rounded-full text-base font-medium ${
                  eligibilityStatus.value === 'Not checked' ? 'bg-gray-100 text-gray-800' :
                  eligibilityStatus.value.includes('feasible_no_check') ? 'bg-green-100 text-green-800' :
                  eligibilityStatus.value.includes('feasible_check') ? 'bg-yellow-100 text-yellow-800' :
                  eligibilityStatus.value.includes('not_feasible') ? 'bg-red-100 text-red-800' :
                  'bg-gray-100 text-gray-800'
                }`}>
                  {statusDisplay}
                </span>
              </div>
            </div>
            <div className="flex items-center">
              <button
                onClick={() => setIsDocumentModalOpen(true)}
                className={`btn btn-outline bg-white shadow-sm ${!hasDocumentLink ? 'btn-disabled' : ''}`}
                style={{ borderColor: '#3b28c7', color: '#3b28c7' }}
                onMouseEnter={(e) => {
                  if (!e.currentTarget.disabled) {
                    e.currentTarget.style.backgroundColor = '#f3f0ff';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!e.currentTarget.disabled) {
                    e.currentTarget.style.backgroundColor = 'white';
                  }
                }}
                disabled={!hasDocumentLink}
              >
                <FolderIcon className="w-5 h-5" />
                Documents
                <span className="badge text-white ml-2" style={{ backgroundColor: '#3b28c7' }}>{documentCount}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Section Eligibility and Expert Notes Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Section Eligibility */}
        <div className="bg-white border border-gray-200 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-200 overflow-hidden">
          <div className="pl-6 pt-2 pb-2 w-2/5">
            <h4 className="text-lg font-semibold text-black">Section Eligibility</h4>
            <div className="border-b border-gray-200 mt-2"></div>
          </div>
          <div className="p-6">
            <div className="space-y-4">
              {/* Eligibility Dropdown */}
              <div className="space-y-2">
                <label className="text-base font-medium text-gray-500 uppercase tracking-wide">Eligibility Assessment</label>
                <select 
                  className="select select-bordered w-full"
                  value={eligibilityStatus.value}
                  onChange={(e) => handleEligibilityChange(e.target.value)}
                >
                  <option value="">Set Eligibility...</option>
                  {eligibilityOptions.map((option) => (
                    <option 
                      key={option.value} 
                      value={option.value}
                    >
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              
              {/* Citizenship Section Dropdown */}
              <div className="space-y-2">
                <label className="text-base font-medium text-gray-500 uppercase tracking-wide">Citizenship Section</label>
                <div className="relative">
                  <select 
                    className="select select-bordered w-full"
                    value={selectedSection}
                    onChange={(e) => handleSectionChange(e.target.value)}
                    disabled={!eligibilityStatus.value || eligibilityStatus.value === 'not_feasible'}
                  >
                    <option value="">Select citizenship section...</option>
                    {sections.map((section) => (
                      <option 
                        key={section.value} 
                        value={section.value}
                      >
                        {section.label}
                      </option>
                    ))}
                  </select>
                  <HashtagIcon className="w-5 h-5 absolute right-10 top-1/2 transform -translate-y-1/2 pointer-events-none text-gray-400" />
                </div>
              </div>
              
              {/* Timestamp */}
              {eligibilityStatus.timestamp && (
                <div className="text-sm text-gray-400 flex justify-between border-t border-gray-100 pt-3">
                  <span>Last updated: {new Date(eligibilityStatus.timestamp).toLocaleString()}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Expert Opinion Notes */}
        <div className="bg-white border border-gray-200 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-200 overflow-hidden">
          <div className="pl-6 pt-2 pb-2 w-2/5">
            <div className="flex items-center justify-between">
              <h4 className="text-lg font-semibold text-black">Expert Notes</h4>
              {!isAddingExpertNote && !editingExpertNoteId && (
                <button 
                  className="btn btn-ghost btn-md bg-transparent hover:bg-transparent shadow-none"
                  onClick={() => {
                    setIsAddingExpertNote(true);
                    setNewExpertNoteContent('');
                  }}
                >
                  <PencilSquareIcon className="w-5 h-5 text-black" />
                </button>
              )}
            </div>
            <div className="border-b border-gray-200 mt-2"></div>
          </div>
          <div className="p-6">
            {/* Add/Edit Expert Note Form */}
            {(isAddingExpertNote || editingExpertNoteId) && (
              <div className="mb-6">
                <textarea
                  className="textarea textarea-bordered w-full h-32 mb-3"
                  placeholder="Enter your note..."
                  value={newExpertNoteContent}
                  onChange={(e) => setNewExpertNoteContent(e.target.value)}
                />
                <div className="flex justify-end gap-2">
                  <button 
                    className="btn btn-ghost btn-sm hover:bg-red-50"
                    onClick={handleCancelExpertEdit}
                  >
                    <XMarkIcon className="w-4 h-4 text-red-600" />
                    Cancel
                  </button>
                  <button 
                    className="btn btn-sm"
                    style={{ backgroundColor: '#3b28c7', color: 'white' }}
                    onClick={handleSaveExpertNote}
                    disabled={!newExpertNoteContent.trim()}
                  >
                    <CheckIcon className="w-4 h-4" />
                    Save
                  </button>
                </div>
              </div>
            )}

            {/* Expert Notes List */}
            <div className="space-y-4 overflow-y-auto max-h-[300px]">
              {expertNotes.length > 0 ? (
                expertNotes.map((note) => (
                  <div 
                    key={note.id} 
                    className={`bg-gray-50 rounded-lg p-4 ${
                      editingExpertNoteId === note.id ? 'ring-2' : ''
                    }`}
                    style={editingExpertNoteId === note.id ? { '--tw-ring-color': '#3b28c7', '--tw-ring-opacity': '0.2' } as React.CSSProperties : {}}
                  >
                    {editingExpertNoteId === note.id ? (
                      <textarea
                        className="textarea textarea-bordered w-full h-32 mb-3"
                        value={newExpertNoteContent}
                        onChange={(e) => setNewExpertNoteContent(e.target.value)}
                      />
                    ) : (
                      <>
                        <div className="text-sm text-gray-400 mb-2">
                          {note.timestamp}
                        </div>
                        <p className="text-base text-gray-900 whitespace-pre-wrap">{note.content}</p>
                      </>
                    )}
                  </div>
                ))
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <div className="bg-gray-50 rounded-lg p-6">
                    <p className="text-lg font-medium mb-1">No expert notes yet</p>
                    <p className="text-base">Expert opinions and assessments will appear here</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Handler Opinion Section */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-200 overflow-hidden">
        <div className="pl-6 pt-2 pb-2 w-2/5">
          <div className="flex items-center justify-between">
            <h4 className="text-lg font-semibold text-black">Handler Notes</h4>
            {!isAddingHandlerNote && !editingHandlerNoteId && (
              <button
                className="btn btn-ghost btn-md bg-transparent hover:bg-transparent shadow-none"
                onClick={() => {
                  if (handlerNotes.length > 0) {
                    handleEditHandlerNote(handlerNotes[handlerNotes.length - 1]);
                  } else {
                    setIsAddingHandlerNote(true);
                    setNewHandlerNoteContent('');
                  }
                }}
                title="Edit Handler Note"
              >
                <PencilSquareIcon className="w-5 h-5 text-black" />
              </button>
            )}
          </div>
          <div className="border-b border-gray-200 mt-2"></div>
        </div>
        <div className="p-6">
          {/* Add/Edit Handler Note Form */}
          {(isAddingHandlerNote || editingHandlerNoteId) && (
            <div className="mb-6">
              <textarea
                className="textarea textarea-bordered w-full h-32 mb-3"
                placeholder="Enter your note..."
                value={newHandlerNoteContent}
                onChange={(e) => setNewHandlerNoteContent(e.target.value)}
              />
              <div className="flex justify-end gap-2">
                <button 
                  className="btn btn-ghost btn-sm hover:bg-red-50"
                  onClick={handleCancelHandlerEdit}
                >
                  <XMarkIcon className="w-4 h-4 text-red-600" />
                  Cancel
                </button>
                <button 
                  className="btn btn-sm"
                  style={{ backgroundColor: '#3b28c7', color: 'white' }}
                  onClick={handleSaveHandlerNote}
                  disabled={!newHandlerNoteContent.trim()}
                >
                  <CheckIcon className="w-4 h-4" />
                  Save
                </button>
              </div>
            </div>
          )}

          {/* Handler Notes List */}
          <div className="space-y-4 overflow-y-auto max-h-[300px]">
            {handlerNotes.length > 0 ? (
              handlerNotes.map((note) => (
                <div 
                  key={note.id} 
                  className={`bg-gray-50 rounded-lg p-4 relative ${editingHandlerNoteId === note.id ? 'ring-2 ring-[#3b28c7]/20' : ''}`}
                >
                  {editingHandlerNoteId === note.id ? (
                    <textarea
                      className="textarea textarea-bordered w-full h-32 mb-3"
                      value={newHandlerNoteContent}
                      onChange={(e) => setNewHandlerNoteContent(e.target.value)}
                    />
                  ) : (
                    <>
                      <div className="text-sm text-gray-400 mb-2">{note.timestamp}</div>
                      <p className="text-base text-gray-900 whitespace-pre-wrap">{note.content}</p>
                    </>
                  )}
                </div>
              ))
            ) : (
              <div className="text-center py-8 text-gray-500">
                <div className="bg-gray-50 rounded-lg p-6">
                  <p className="text-lg font-medium mb-1">No handler notes yet</p>
                  <p className="text-base">Case handling notes and updates will appear here</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Document Upload Section */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-200 overflow-hidden">
        <div className="pl-6 pt-2 pb-2 w-2/5">
          <h4 className="text-lg font-semibold text-black">Document Upload</h4>
          <div className="border-b border-gray-200 mt-2"></div>
        </div>
        <div className="p-6">
          <div className="space-y-4">
            {/* Upload Area */}
            <div 
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors duration-200 ${
                isUploading 
                  ? 'bg-gray-50 border-gray-300' 
                  : 'bg-gray-50 border-gray-300'
              }`}
              style={{
                borderColor: isUploading ? '#3b28c7' : '',
                backgroundColor: isUploading ? '#f3f0ff' : ''
              }}
              onMouseEnter={(e) => {
                if (!isUploading) {
                  e.currentTarget.style.borderColor = '#3b28c7';
                  e.currentTarget.style.backgroundColor = '#f3f0ff';
                }
              }}
              onMouseLeave={(e) => {
                if (!isUploading) {
                  e.currentTarget.style.borderColor = '#d1d5db';
                  e.currentTarget.style.backgroundColor = '#f9fafb';
                }
              }}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onDrop={handleFileDrop}
            >
              <DocumentArrowUpIcon className="w-12 h-12 mx-auto text-gray-400 mb-4" />
              <div className="text-base text-gray-600 mb-4">
                {isUploading ? 'Processing files...' : 'Drag and drop files here, or click to select files'}
              </div>
              <input
                type="file"
                className="hidden"
                id="file-upload"
                multiple
                onChange={handleFileInput}
                disabled={isUploading}
              />
              <label
                htmlFor="file-upload"
                className={`btn btn-outline bg-white ${isUploading ? 'btn-disabled' : ''}`}
                style={{ borderColor: '#3b28c7', color: '#3b28c7' }}
                onMouseEnter={(e) => {
                  if (!isUploading) {
                    e.currentTarget.style.backgroundColor = '#f3f0ff';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isUploading) {
                    e.currentTarget.style.backgroundColor = 'white';
                  }
                }}
              >
                <PaperClipIcon className="w-5 h-5" />
                Choose Files
              </label>
            </div>

            {/* Uploaded Files List */}
            {uploadedFiles.length > 0 && (
              <div className="space-y-2">
                {uploadedFiles.map((file, index) => (
                  <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200">
                    <div className="flex items-center gap-3">
                      <PaperClipIcon className="w-5 h-5" style={{ color: '#3b28c7' }} />
                      <span className="text-base font-medium text-gray-900">{file.name}</span>
                    </div>
                    <div>
                      {file.status === 'uploading' && (
                        <div className="radial-progress" style={{ "--value": file.progress || 0, color: '#3b28c7' } as any}>
                          {file.progress || 0}%
                        </div>
                      )}
                      {file.status === 'success' && (
                        <CheckCircleIcon className="w-6 h-6 text-green-500" />
                      )}
                      {file.status === 'error' && (
                        <div className="tooltip" data-tip={file.error}>
                          <XCircleIcon className="w-6 h-6 text-red-500" />
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Document Modal */}
      <DocumentModal
        isOpen={isDocumentModalOpen}
        onClose={() => setIsDocumentModalOpen(false)}
        leadNumber={client.lead_number || ''}
        clientName={client.name || ''}
        onDocumentCountChange={handleDocumentCountChange}
      />
      
      <TimelineHistoryButtons client={client} />
    </div>
  );
};

export default ExpertTab; 