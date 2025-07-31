import React, { useState, useEffect } from 'react';
import { 
  DocumentTextIcon,
  PlusIcon,
  PencilIcon,
  TrashIcon,
  XMarkIcon
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
  const [notes, setNotes] = useState<{ [leadId: string]: string }>({});
  const [editingLeadId, setEditingLeadId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const saveNote = async (leadId: string, noteText: string) => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('leads')
        .update({ notes: noteText })
        .eq('id', leadId);

      if (error) throw error;
      
      toast.success('Note saved successfully');
      setEditingLeadId(null);
    } catch (error) {
      console.error('Error saving note:', error);
      toast.error('Failed to save note');
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    // Initialize notes from leads
    const initialNotes: { [leadId: string]: string } = {};
    leads.forEach(lead => {
      initialNotes[lead.id] = lead.notes || '';
    });
    setNotes(initialNotes);
  }, [leads]);

  return (
    <div className="w-full px-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
        <div>
          <h3 className="text-xl font-bold text-gray-900">Notes Management</h3>
          <p className="text-gray-600">Add and manage notes for individual cases</p>
        </div>
      </div>

      {/* Notes for each lead */}
      {leads.length === 0 ? (
        <div className="text-center py-16 px-8 text-gray-500">
          <DocumentTextIcon className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          <p className="text-lg font-medium mb-1">No cases found</p>
          <p className="text-base">No cases available to add notes to</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {leads.map((lead) => (
            <div key={lead.id} className="bg-white rounded-xl shadow-lg border border-gray-200 p-8 mb-8">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h4 className="text-lg font-bold text-gray-900">{lead.name}</h4>
                  <p className="text-blue-600 font-medium">Lead #{lead.lead_number}</p>
                </div>
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => setEditingLeadId(editingLeadId === lead.id ? null : lead.id)}
                >
                  {editingLeadId === lead.id ? (
                    <XMarkIcon className="w-4 h-4" />
                  ) : (
                    <PencilIcon className="w-4 h-4" />
                  )}
                </button>
              </div>

              {editingLeadId === lead.id ? (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Notes for {lead.name}
                    </label>
                    <textarea
                      className="textarea textarea-bordered w-full h-32 resize-none"
                      value={notes[lead.id] || ''}
                      onChange={(e) => setNotes(prev => ({ ...prev, [lead.id]: e.target.value }))}
                      placeholder="Enter your notes here..."
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      className="btn btn-primary"
                      onClick={() => saveNote(lead.id, notes[lead.id] || '')}
                      disabled={saving}
                    >
                      {saving ? (
                        <div className="loading loading-spinner loading-sm"></div>
                      ) : (
                        'Save Note'
                      )}
                    </button>
                    <button
                      className="btn btn-outline"
                      onClick={() => setEditingLeadId(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  {notes[lead.id] ? (
                    <div className="bg-gray-50 rounded-lg p-4">
                      <p className="text-gray-700 whitespace-pre-wrap">{notes[lead.id]}</p>
                    </div>
                  ) : (
                    <div className="text-center py-16 px-8 text-gray-500">
                      <DocumentTextIcon className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                      <p className="text-sm">No notes added yet</p>
                      <p className="text-xs text-gray-400">Click edit to add notes</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default NotesTab; 