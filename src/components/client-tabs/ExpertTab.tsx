import React, { useState, useEffect } from 'react';
import { ClientTabProps } from '../../types/client';
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
    await supabase
      .from('leads')
      .update({ eligibility_status: newValue, eligibility_status_timestamp: timestamp, section_eligibility: newValue === 'not_feasible' ? '' : selectedSection })
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
            await supabase
                .from('leads')
                .update({ onedrive_folder_link: folderUrl })
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
    <div className="p-6 space-y-8">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <AcademicCapIcon className="w-6 h-6 text-primary" />
        <h3 className="text-xl font-semibold">Expert Assignment</h3>
      </div>

      {/* Main Card */}
      <div className="card bg-base-100 shadow-lg p-6">
        <div className="flex flex-col md:flex-row md:items-center md:gap-8 gap-4">
          <div className="flex-1">
            <div className="text-2xl font-bold mb-1">Expert: <span className="text-primary">{expertName}</span></div>
            <div className="flex items-center gap-2 mt-2 mb-2">
              <span className="text-lg font-medium">status:</span>
              <span className={`rounded-full px-5 py-2 text-white font-bold text-lg shadow-md transition-colors duration-200
                ${
                  eligibilityStatus.value === 'Not checked' ? 'bg-neutral' :
                  eligibilityStatus.value.includes('feasible_no_check') ? 'bg-emerald-400' :
                  eligibilityStatus.value.includes('feasible_check') ? 'bg-yellow-400' :
                  eligibilityStatus.value.includes('not_feasible') ? 'bg-red-500' :
                  'bg-neutral'
                }
              `}>
                {statusDisplay}
              </span>
            </div>
          </div>
          <div className="flex items-center mt-2 md:mt-0">
            <button
              onClick={() => setIsDocumentModalOpen(true)}
              className={`btn btn-outline btn-primary flex items-center gap-2 px-4 py-2 text-base font-semibold rounded-lg shadow hover:bg-primary hover:text-white transition-colors ${!hasDocumentLink ? 'btn-disabled' : ''}`}
              disabled={!hasDocumentLink}
            >
              <FolderIcon className="w-5 h-5" />
              Documents
              <span className="badge badge-primary badge-sm ml-2">{documentCount}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Two Column Layout for Section and Expert Notes */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Section Eligibility */}
        <div className="card bg-base-100 shadow-lg p-6">
          <h3 className="text-lg font-semibold mb-4">Section Eligibility</h3>
          <div className="space-y-4">
            {/* Eligibility Dropdown FIRST */}
            <div className="relative">
              <select 
                className="select select-bordered w-full text-base"
                value={eligibilityStatus.value}
                onChange={(e) => handleEligibilityChange(e.target.value)}
              >
                <option value="">Set Eligibility...</option>
                {eligibilityOptions.map((option) => (
                  <option 
                    key={option.value} 
                    value={option.value}
                    className="py-2"
                  >
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            {/* Citizenship Section Dropdown SECOND, disabled if no eligibility or if 'not_feasible' */}
            <div className="relative">
              <select 
                className="select select-bordered w-full text-base"
                value={selectedSection}
                onChange={(e) => handleSectionChange(e.target.value)}
                disabled={!eligibilityStatus.value || eligibilityStatus.value === 'not_feasible'}
              >
                <option value="">Select citizenship section...</option>
                {sections.map((section) => (
                  <option 
                    key={section.value} 
                    value={section.value}
                    className="py-2"
                  >
                    {section.label}
                  </option>
                ))}
              </select>
              <HashtagIcon className="w-5 h-5 absolute right-10 top-1/2 transform -translate-y-1/2 pointer-events-none text-base-content/50" />
            </div>
            {/* Status and Timestamp Display */}
            <div className="flex flex-col gap-2 mt-2">
              {eligibilityStatus.timestamp && (
                <div className="flex items-center gap-2 text-sm text-base-content/70">
                  <ClockIcon className="w-4 h-4" />
                  <span>Last updated: {new Date(eligibilityStatus.timestamp).toLocaleString()}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Expert Opinion Notes */}
        <div className="card bg-base-100 shadow-lg p-6">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-lg font-semibold">Expert Notes</h3>
            {!isAddingExpertNote && !editingExpertNoteId && (
              <button 
                className="btn btn-primary btn-sm gap-2"
                onClick={() => {
                  setIsAddingExpertNote(true);
                  setNewExpertNoteContent('');
                }}
              >
                <PencilSquareIcon className="w-4 h-4" />
                Add Note
              </button>
            )}
          </div>

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
                  className="btn btn-ghost btn-sm"
                  onClick={handleCancelExpertEdit}
                >
                  <XMarkIcon className="w-4 h-4" />
                  Cancel
                </button>
                <button 
                  className="btn btn-primary btn-sm"
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
            {expertNotes.map((note) => (
              <div 
                key={note.id} 
                className={`bg-base-200 rounded-lg p-4 ${
                  editingExpertNoteId === note.id ? 'ring-2 ring-primary' : ''
                }`}
              >
                {editingExpertNoteId === note.id ? (
                  <textarea
                    className="textarea textarea-bordered w-full h-32 mb-3"
                    value={newExpertNoteContent}
                    onChange={(e) => setNewExpertNoteContent(e.target.value)}
                  />
                ) : (
                  <>
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-2 text-base-content/70">
                        <ClockIcon className="w-4 h-4" />
                        <span className="text-sm">{note.timestamp}</span>
                      </div>
                      <button 
                        className="btn btn-ghost btn-sm"
                        onClick={() => handleEditExpertNote(note)}
                      >
                        <PencilSquareIcon className="w-4 h-4" />
                      </button>
                    </div>
                    <p className="text-base-content whitespace-pre-wrap">{note.content}</p>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Handler Opinion Section */}
      <div className="card bg-base-100 shadow-lg p-6">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-lg font-semibold">Handler Notes</h3>
          {!isAddingHandlerNote && !editingHandlerNoteId && (
            <button 
              className="btn btn-primary btn-sm gap-2"
              onClick={() => {
                setIsAddingHandlerNote(true);
                setNewHandlerNoteContent('');
              }}
            >
              <PencilSquareIcon className="w-4 h-4" />
              Add Note
            </button>
          )}
        </div>

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
                className="btn btn-ghost btn-sm"
                onClick={handleCancelHandlerEdit}
              >
                <XMarkIcon className="w-4 h-4" />
                Cancel
              </button>
              <button 
                className="btn btn-primary btn-sm"
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
          {handlerNotes.map((note) => (
            <div 
              key={note.id} 
              className={`bg-base-200 rounded-lg p-4 ${
                editingHandlerNoteId === note.id ? 'ring-2 ring-primary' : ''
              }`}
            >
              {editingHandlerNoteId === note.id ? (
                <textarea
                  className="textarea textarea-bordered w-full h-32 mb-3"
                  value={newHandlerNoteContent}
                  onChange={(e) => setNewHandlerNoteContent(e.target.value)}
                />
              ) : (
                <>
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex items-center gap-2 text-base-content/70">
                      <ClockIcon className="w-4 h-4" />
                      <span className="text-sm">{note.timestamp}</span>
                    </div>
                    <button 
                      className="btn btn-ghost btn-sm"
                      onClick={() => handleEditHandlerNote(note)}
                    >
                      <PencilSquareIcon className="w-4 h-4" />
                    </button>
                  </div>
                  <p className="text-base-content whitespace-pre-wrap">{note.content}</p>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Document Upload Section */}
      <div className="card bg-base-100 shadow-lg p-6">
        <h3 className="text-lg font-semibold mb-4">Documents</h3>
        <div className="flex flex-col gap-4">
          {/* Upload Area */}
          <div 
            className={`border-2 border-dashed border-base-300 rounded-lg p-8 text-center transition-colors duration-200 ${isUploading ? 'bg-primary/10 border-primary' : 'bg-base-200'}`}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onDrop={handleFileDrop}
          >
            <DocumentArrowUpIcon className="w-12 h-12 mx-auto text-base-content/50 mb-4" />
            <div className="text-base-content/70 mb-4">
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
              className={`btn btn-outline gap-2 ${isUploading ? 'btn-disabled' : ''}`}
            >
              <PaperClipIcon className="w-5 h-5" />
              Choose Files
            </label>
          </div>

          {/* Uploaded Files List */}
          <div className="space-y-2">
            {uploadedFiles.map((file, index) => (
              <div key={index} className="flex items-center justify-between p-3 bg-base-200 rounded-lg">
                <div className="flex items-center gap-3">
                  <PaperClipIcon className="w-5 h-5 text-primary" />
                  <span className="font-medium">{file.name}</span>
                </div>
                <div>
                  {file.status === 'uploading' && (
                    <div className="radial-progress text-primary" style={{ "--value": file.progress || 0 } as any}>
                      {file.progress || 0}%
                    </div>
                  )}
                  {file.status === 'success' && (
                    <CheckCircleIcon className="w-6 h-6 text-success" />
                  )}
                  {file.status === 'error' && (
                    <div className="tooltip" data-tip={file.error}>
                      <XCircleIcon className="w-6 h-6 text-error" />
                    </div>
                  )}
                </div>
              </div>
            ))}
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
    </div>
  );
};

export default ExpertTab; 