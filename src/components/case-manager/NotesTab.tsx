import React, { useState, useEffect } from 'react';
import { 
  DocumentTextIcon,
  PlusIcon,
  PencilIcon,
  TrashIcon,
  XMarkIcon,
  StarIcon,
  EyeIcon,
  EyeSlashIcon,
  TagIcon,
  CalendarIcon,
  UserIcon,
  EllipsisVerticalIcon
} from '@heroicons/react/24/outline';
import { supabase } from '../../lib/supabase';
import { toast } from 'react-hot-toast';

interface HandlerLead {
  id: string;
  lead_number: string;
  name: string;
  email?: string;
  phone?: string;
  category?: string;
  stage: string;
  handler_stage?: string;
  created_at: string;
  balance?: number;
  balance_currency?: string;
  onedrive_folder_link?: string;
  expert?: string;
  handler?: string;
  closer?: string;
  scheduler?: string;
  manager?: string;
  notes?: string;
}

interface LeadNote {
  id: string;
  lead_id: string;
  title?: string;
  content: string;
  note_type: 'general' | 'internal' | 'client' | 'important';
  created_by: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
  is_important: boolean;
  is_private: boolean;
  tags: string[];
  contact_id?: string;
  contact?: {
    id: string;
    name: string;
    relationship: string;
  };
}

interface HandlerTabProps {
  leads: HandlerLead[];
  uploadFiles: (lead: HandlerLead, files: File[]) => Promise<void>;
  uploadingLeadId: string | null;
  uploadedFiles: { [leadId: string]: any[] };
  isUploading: boolean;
  handleFileInput: (lead: HandlerLead, e: React.ChangeEvent<HTMLInputElement>) => void;
  refreshLeads: () => Promise<void>;
}

const NotesTab: React.FC<HandlerTabProps> = ({ leads }) => {
  const [notes, setNotes] = useState<{ [leadId: string]: LeadNote[] }>({});
  const [loading, setLoading] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingNote, setEditingNote] = useState<LeadNote | null>(null);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<string>('all');
  const [filterImportant, setFilterImportant] = useState<boolean>(false);
  const [contacts, setContacts] = useState<{ [leadId: string]: any[] }>({});
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);

  // New note form state
  const [newNote, setNewNote] = useState({
    title: '',
    content: '',
    note_type: 'general' as const,
    is_important: false,
    is_private: false,
    tags: [] as string[],
    contact_id: '' as string
  });

  const fetchNotes = async (leadId: string) => {
    try {
      const { data, error } = await supabase
        .from('lead_notes')
        .select(`
          *,
          contact:contacts(id, name, relationship)
        `)
        .eq('lead_id', leadId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      setNotes(prev => ({
        ...prev,
        [leadId]: data || []
      }));
    } catch (error) {
      console.error('Error fetching notes:', error);
      toast.error('Failed to fetch notes');
    }
  };

  const fetchContacts = async (leadId: string) => {
    try {
      const { data, error } = await supabase
        .from('contacts')
        .select('id, name, relationship')
        .eq('lead_id', leadId)
        .order('name');

      if (error) throw error;
      
      setContacts(prev => ({
        ...prev,
        [leadId]: data || []
      }));
    } catch (error) {
      console.error('Error fetching contacts:', error);
    }
  };

  const createNote = async () => {
    if (!selectedLeadId || !newNote.content.trim()) {
      toast.error('Please select a lead and enter note content');
      return;
    }

    setLoading(true);
    try {
      // Get current user information
      const { data: { user } } = await supabase.auth.getUser();
      const currentUser = user;
      
      // Get user's full name from users table
      let userName = 'Unknown User';
      if (currentUser) {
        const { data: userData } = await supabase
          .from('users')
          .select('full_name')
          .eq('id', currentUser.id)
          .single();
        
        if (userData?.full_name) {
          userName = userData.full_name;
        } else {
          // Fallback to email if full_name not found
          userName = currentUser.email || 'Unknown User';
        }
      }

      const { data, error } = await supabase.rpc('create_lead_note_with_user', {
        p_lead_id: selectedLeadId,
        p_title: newNote.title || null,
        p_content: newNote.content,
        p_note_type: newNote.note_type,
        p_is_important: newNote.is_important,
        p_is_private: newNote.is_private,
        p_tags: newNote.tags,
        p_contact_id: newNote.contact_id || null,
        p_user_id: currentUser?.id || null,
        p_user_name: userName
      });

      if (error) throw error;
      
      toast.success('Note created successfully');
      setShowCreateModal(false);
      setNewNote({
        title: '',
        content: '',
        note_type: 'general',
        is_important: false,
        is_private: false,
        tags: [],
        contact_id: ''
      });
      await fetchNotes(selectedLeadId);
    } catch (error) {
      console.error('Error creating note:', error);
      toast.error('Failed to create note');
    } finally {
      setLoading(false);
    }
  };

  const updateNote = async () => {
    if (!editingNote) return;

    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('update_lead_note', {
        p_note_id: editingNote.id,
        p_title: editingNote.title || null,
        p_content: editingNote.content,
        p_note_type: editingNote.note_type,
        p_is_important: editingNote.is_important,
        p_is_private: editingNote.is_private,
        p_tags: editingNote.tags,
        p_contact_id: editingNote.contact_id || null
      });

      if (error) throw error;
      
      toast.success('Note updated successfully');
      setEditingNote(null);
      await fetchNotes(editingNote.lead_id);
    } catch (error) {
      console.error('Error updating note:', error);
      toast.error('Failed to update note');
    } finally {
      setLoading(false);
    }
  };

  const deleteNote = async (noteId: string, leadId: string) => {
    if (!confirm('Are you sure you want to delete this note?')) return;

    setLoading(true);
    try {
      const { error } = await supabase
        .from('lead_notes')
        .delete()
        .eq('id', noteId);

      if (error) throw error;
      
      toast.success('Note deleted successfully');
      await fetchNotes(leadId);
    } catch (error) {
      console.error('Error deleting note:', error);
      toast.error('Failed to delete note');
    } finally {
      setLoading(false);
    }
  };

  const getNoteTypeColor = (type: string) => {
    switch (type) {
      case 'important': return 'bg-red-100 text-red-800';
      case 'internal': return 'bg-blue-100 text-blue-800';
      case 'client': return 'bg-green-100 text-green-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  useEffect(() => {
    // Fetch notes and contacts for all leads
    leads.forEach(lead => {
      fetchNotes(lead.id);
      fetchContacts(lead.id);
    });
  }, [leads]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (openDropdownId) {
        setOpenDropdownId(null);
      }
    };

    document.addEventListener('click', handleClickOutside);
    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, [openDropdownId]);

  const filteredNotes = (leadId: string) => {
    const leadNotes = notes[leadId] || [];
    return leadNotes.filter(note => {
      const matchesType = filterType === 'all' || note.note_type === filterType;
      const matchesImportant = !filterImportant || note.is_important;
      return matchesType && matchesImportant;
    });
  };

  return (
    <div className="w-full px-4 md:px-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
        <div>
          <h3 className="text-xl font-bold text-gray-900">Notes Management</h3>
          <p className="text-gray-600">Add and manage notes for individual cases</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-4 p-4 md:p-6 mb-8 bg-gray-50 rounded-lg">
        <select 
          className="select select-bordered"
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
        >
          <option value="all">All Types</option>
          <option value="general">General</option>
          <option value="internal">Internal</option>
          <option value="client">Client</option>
          <option value="important">Important</option>
        </select>
        <label className="label cursor-pointer gap-2">
          <input 
            type="checkbox" 
            className="checkbox checkbox-primary"
            checked={filterImportant}
            onChange={(e) => setFilterImportant(e.target.checked)}
          />
          <span className="label-text">Important Only</span>
        </label>
      </div>

      {/* Notes for each lead */}
      {leads.length === 0 ? (
        <div className="text-center py-16 px-4 md:px-8 text-gray-500">
          <DocumentTextIcon className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          <p className="text-lg font-medium mb-1">No cases found</p>
          <p className="text-base">No cases available to add notes to</p>
        </div>
      ) : (
        <div className="space-y-8">
          {leads.map((lead) => (
            <div key={lead.id} className="bg-white rounded-xl shadow-lg border border-gray-200 p-4 md:p-6">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h4 className="text-lg font-bold text-gray-900">{lead.name}</h4>
                  <p className="text-blue-600 font-medium">Lead #{lead.lead_number}</p>
                </div>
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => {
                    setSelectedLeadId(lead.id);
                    setShowCreateModal(true);
                  }}
                >
                  <PlusIcon className="w-4 h-4" />
                  Add Note
                </button>
              </div>

              {/* Notes List */}
              <div className="space-y-4">
                {filteredNotes(lead.id).length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <DocumentTextIcon className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                    <p className="text-sm">No notes found</p>
                    <p className="text-xs text-gray-400">Add your first note</p>
                  </div>
                ) : (
                  filteredNotes(lead.id).map((note) => (
                    <div key={note.id} className="border border-gray-200 rounded-lg p-3 md:p-4 hover:shadow-md transition-shadow">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
                          <div className="flex items-center gap-2">
                            {note.is_important && (
                              <StarIcon className="w-4 h-4 text-yellow-500" />
                            )}
                            {note.is_private && (
                              <EyeSlashIcon className="w-4 h-4 text-gray-500" />
                            )}
                            <span className={`badge badge-sm ${getNoteTypeColor(note.note_type)}`}>
                              {note.note_type}
                            </span>
                          </div>
                          {/* Contact Tag - moved below general tag on mobile */}
                          {note.contact && (
                            <span className="badge badge-sm bg-gradient-to-tr from-blue-500 via-cyan-500 to-teal-400 text-white border-none">
                              <UserIcon className="w-2 h-2 mr-1" />
                              {note.contact.name} ({note.contact.relationship})
                            </span>
                          )}
                        </div>
                        <div className="relative">
                          <button
                            className="btn btn-xs btn-ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              // Toggle dropdown for this specific note
                              setOpenDropdownId(openDropdownId === note.id ? null : note.id);
                            }}
                          >
                            <EllipsisVerticalIcon className="w-7 h-7" />
                          </button>
                          
                          {/* Dropdown Menu */}
                          {openDropdownId === note.id && (
                            <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10 min-w-[120px]">
                              <button
                                className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2"
                                onClick={() => {
                                  setEditingNote(note);
                                  setOpenDropdownId(null);
                                }}
                              >
                                <PencilIcon className="w-3 h-3" />
                                Edit
                              </button>
                              <button
                                className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 text-red-500 flex items-center gap-2"
                                onClick={() => {
                                  deleteNote(note.id, note.lead_id);
                                  setOpenDropdownId(null);
                                }}
                              >
                                <TrashIcon className="w-3 h-3" />
                                Delete
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      {note.title && (
                        <h5 className="font-semibold text-gray-900 mb-2">{note.title}</h5>
                      )}
                      
                      <p className="text-gray-700 whitespace-pre-wrap mb-3">{note.content}</p>

                                             {/* Tags */}
                       {note.tags && note.tags.length > 0 && (
                         <div className="flex flex-wrap gap-1 mb-3">
                           {note.tags.map((tag, index) => (
                             <span key={index} className="badge badge-xs badge-outline">
                               <TagIcon className="w-2 h-2 mr-1" />
                               {tag}
                             </span>
                           ))}
                         </div>
                       )}



                      {/* Footer */}
                      <div className="flex items-center justify-between text-xs text-gray-500">
                        <div className="flex items-center gap-4">
                          <span className="flex items-center gap-1">
                            <UserIcon className="w-3 h-3" />
                            {note.created_by_name}
                          </span>
                          <span className="flex items-center gap-1">
                            <CalendarIcon className="w-3 h-3" />
                            {formatDate(note.created_at)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Note Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">Add New Note</h3>
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => setShowCreateModal(false)}
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Lead
                </label>
                <select
                  className="select select-bordered w-full"
                  value={selectedLeadId || ''}
                  onChange={(e) => setSelectedLeadId(e.target.value)}
                >
                  <option value="">Select a lead</option>
                  {leads.map(lead => (
                    <option key={lead.id} value={lead.id}>
                      {lead.name} (#{lead.lead_number})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Title (Optional)
                </label>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  value={newNote.title}
                  onChange={(e) => setNewNote(prev => ({ ...prev, title: e.target.value }))}
                  placeholder="Note title..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Content
                </label>
                <textarea
                  className="textarea textarea-bordered w-full h-32"
                  value={newNote.content}
                  onChange={(e) => setNewNote(prev => ({ ...prev, content: e.target.value }))}
                  placeholder="Enter your note content..."
                />
              </div>

                             <div className="grid grid-cols-2 gap-4">
                 <div>
                   <label className="block text-sm font-medium text-gray-700 mb-2">
                     Note Type
                   </label>
                   <select
                     className="select select-bordered w-full"
                     value={newNote.note_type}
                     onChange={(e) => setNewNote(prev => ({ ...prev, note_type: e.target.value as any }))}
                   >
                     <option value="general">General</option>
                     <option value="internal">Internal</option>
                     <option value="client">Client</option>
                     <option value="important">Important</option>
                   </select>
                 </div>

                 <div>
                   <label className="block text-sm font-medium text-gray-700 mb-2">
                     Tags (comma separated)
                   </label>
                   <input
                     type="text"
                     className="input input-bordered w-full"
                     value={newNote.tags.join(', ')}
                     onChange={(e) => setNewNote(prev => ({ 
                       ...prev, 
                       tags: e.target.value.split(',').map(tag => tag.trim()).filter(tag => tag)
                     }))}
                     placeholder="tag1, tag2, tag3..."
                   />
                 </div>
               </div>

               {/* Contact Selection */}
               {selectedLeadId && contacts[selectedLeadId] && contacts[selectedLeadId].length > 0 && (
                 <div>
                   <label className="block text-sm font-medium text-gray-700 mb-2">
                     Tag Applicant (Optional)
                   </label>
                   <select
                     className="select select-bordered w-full"
                     value={newNote.contact_id}
                     onChange={(e) => setNewNote(prev => ({ ...prev, contact_id: e.target.value }))}
                   >
                     <option value="">No applicant tagged</option>
                     {contacts[selectedLeadId].map(contact => (
                       <option key={contact.id} value={contact.id}>
                         {contact.name} ({contact.relationship})
                       </option>
                     ))}
                   </select>
                 </div>
               )}

              <div className="flex items-center gap-4">
                <label className="label cursor-pointer gap-2">
                  <input 
                    type="checkbox" 
                    className="checkbox checkbox-primary"
                    checked={newNote.is_important}
                    onChange={(e) => setNewNote(prev => ({ ...prev, is_important: e.target.checked }))}
                  />
                  <span className="label-text">Important</span>
                </label>
                <label className="label cursor-pointer gap-2">
                  <input 
                    type="checkbox" 
                    className="checkbox checkbox-primary"
                    checked={newNote.is_private}
                    onChange={(e) => setNewNote(prev => ({ ...prev, is_private: e.target.checked }))}
                  />
                  <span className="label-text">Private</span>
                </label>
              </div>

              <div className="flex gap-2 justify-end">
                <button
                  className="btn btn-outline"
                  onClick={() => setShowCreateModal(false)}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  onClick={createNote}
                  disabled={loading || !selectedLeadId || !newNote.content.trim()}
                >
                  {loading ? (
                    <div className="loading loading-spinner loading-sm"></div>
                  ) : (
                    'Create Note'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Note Modal */}
      {editingNote && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">Edit Note</h3>
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => setEditingNote(null)}
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Title (Optional)
                </label>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  value={editingNote.title || ''}
                  onChange={(e) => setEditingNote(prev => prev ? { ...prev, title: e.target.value } : null)}
                  placeholder="Note title..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Content
                </label>
                <textarea
                  className="textarea textarea-bordered w-full h-32"
                  value={editingNote.content}
                  onChange={(e) => setEditingNote(prev => prev ? { ...prev, content: e.target.value } : null)}
                  placeholder="Enter your note content..."
                />
              </div>

                             <div className="grid grid-cols-2 gap-4">
                 <div>
                   <label className="block text-sm font-medium text-gray-700 mb-2">
                     Note Type
                   </label>
                   <select
                     className="select select-bordered w-full"
                     value={editingNote.note_type}
                     onChange={(e) => setEditingNote(prev => prev ? { ...prev, note_type: e.target.value as any } : null)}
                   >
                     <option value="general">General</option>
                     <option value="internal">Internal</option>
                     <option value="client">Client</option>
                     <option value="important">Important</option>
                   </select>
                 </div>

                 <div>
                   <label className="block text-sm font-medium text-gray-700 mb-2">
                     Tags (comma separated)
                   </label>
                   <input
                     type="text"
                     className="input input-bordered w-full"
                     value={editingNote.tags.join(', ')}
                     onChange={(e) => setEditingNote(prev => prev ? { 
                       ...prev, 
                       tags: e.target.value.split(',').map(tag => tag.trim()).filter(tag => tag)
                     } : null)}
                     placeholder="tag1, tag2, tag3..."
                   />
                 </div>
               </div>

               {/* Contact Selection */}
               {editingNote && contacts[editingNote.lead_id] && contacts[editingNote.lead_id].length > 0 && (
                 <div>
                   <label className="block text-sm font-medium text-gray-700 mb-2">
                     Tag Applicant (Optional)
                   </label>
                   <select
                     className="select select-bordered w-full"
                     value={editingNote.contact_id || ''}
                     onChange={(e) => setEditingNote(prev => prev ? { ...prev, contact_id: e.target.value } : null)}
                   >
                     <option value="">No applicant tagged</option>
                     {contacts[editingNote.lead_id].map(contact => (
                       <option key={contact.id} value={contact.id}>
                         {contact.name} ({contact.relationship})
                       </option>
                     ))}
                   </select>
                 </div>
               )}

              <div className="flex items-center gap-4">
                <label className="label cursor-pointer gap-2">
                  <input 
                    type="checkbox" 
                    className="checkbox checkbox-primary"
                    checked={editingNote.is_important}
                    onChange={(e) => setEditingNote(prev => prev ? { ...prev, is_important: e.target.checked } : null)}
                  />
                  <span className="label-text">Important</span>
                </label>
                <label className="label cursor-pointer gap-2">
                  <input 
                    type="checkbox" 
                    className="checkbox checkbox-primary"
                    checked={editingNote.is_private}
                    onChange={(e) => setEditingNote(prev => prev ? { ...prev, is_private: e.target.checked } : null)}
                  />
                  <span className="label-text">Private</span>
                </label>
              </div>

              <div className="flex gap-2 justify-end">
                <button
                  className="btn btn-outline"
                  onClick={() => setEditingNote(null)}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  onClick={updateNote}
                  disabled={loading || !editingNote.content.trim()}
                >
                  {loading ? (
                    <div className="loading loading-spinner loading-sm"></div>
                  ) : (
                    'Update Note'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default NotesTab; 