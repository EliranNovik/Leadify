import React, { useState, useEffect } from 'react';
import { 
  UserPlusIcon, 
  PencilIcon, 
  TrashIcon, 
  XMarkIcon,
  CheckIcon,
  UserGroupIcon
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
}

interface Contact {
  id: string;
  lead_id: string;
  name: string;
  email?: string;
  phone?: string;
  relationship: 'persecuted_person' | 'spouse' | 'child' | 'parent' | 'sibling' | 'grandchild' | 'grandparent' | 'great_grandchild' | 'great_grandparent' | 'grandson' | 'granddaughter' | 'great_grandson' | 'great_granddaughter' | 'nephew' | 'niece' | 'cousin' | 'uncle' | 'aunt' | 'in_law' | 'other';
  birth_date?: string;
  death_date?: string;
  birth_place?: string;
  current_address?: string;
  citizenship?: string;
  passport_number?: string;
  id_number?: string;
  is_main_applicant: boolean;
  is_persecuted: boolean;
  persecution_details?: any;
  contact_notes?: string;
  document_status: 'pending' | 'complete' | 'incomplete';
  created_at: string;
  updated_at: string;
  document_count?: number;
  completed_documents?: number;
  completion_percentage?: number;
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

// Contacts Tab Component with full CRUD functionality
const ContactsTab: React.FC<HandlerTabProps> = ({ leads, refreshLeads }) => {
    const [contacts, setContacts] = useState<Contact[]>([]);
    const [loading, setLoading] = useState(true);
    const [showAddContactModal, setShowAddContactModal] = useState(false);
    const [editingContact, setEditingContact] = useState<Contact | null>(null);
    const [selectedLead, setSelectedLead] = useState<HandlerLead | null>(null);
  
    // New contact form state
    const [newContact, setNewContact] = useState({
      name: '',
      email: '',
      phone: '',
      relationship: 'other' as Contact['relationship'],
      birth_date: '',
      birth_place: '',
      current_address: '',
      citizenship: '',
      passport_number: '',
      id_number: '',
      is_persecuted: false,
      contact_notes: ''
    });
  
    // Fetch contacts from database
    const fetchContacts = async () => {
      if (leads.length === 0) return;
      
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('contacts')
          .select('*')
          .in('lead_id', leads.length > 0 ? leads.map((lead: HandlerLead) => lead.id) : [])
          .order('is_main_applicant', { ascending: false })
          .order('created_at', { ascending: true });
        
        if (error) {
          toast.error('Error fetching contacts: ' + error.message);
        } else if (data) {
          // Calculate document completion for each contact
          const contactsWithStats = await Promise.all(
            data.map(async (contact) => {
              const { data: docStats } = await supabase
                .from('lead_required_documents')
                .select('status')
                .eq('contact_id', contact.id);
  
              const totalDocs = docStats?.length || 0;
              const completedDocs = docStats?.filter(doc => ['approved', 'received'].includes(doc.status)).length || 0;
              const completionPercentage = totalDocs > 0 ? Math.round((completedDocs / totalDocs) * 100) : 0;
  
              return {
                ...contact,
                document_count: totalDocs,
                completed_documents: completedDocs,
                completion_percentage: completionPercentage
              };
            })
          );
          
          setContacts(contactsWithStats);
        }
      } catch (err) {
        toast.error('Failed to fetch contacts');
        console.error('Error fetching contacts:', err);
      } finally {
        setLoading(false);
      }
    };
  
    useEffect(() => {
      fetchContacts();
    }, [leads]);
  
    // Add new contact
    const addContact = async () => {
      if (!newContact.name.trim() || !selectedLead) {
        toast.error('Contact name and lead are required');
        return;
      }
  
      try {
        const contactData = {
          ...newContact,
          lead_id: selectedLead.id,
          is_main_applicant: newContact.relationship === 'persecuted_person'
        };
  
        const { data: insertedContact, error } = await supabase
          .from('contacts')
          .insert(contactData)
          .select()
          .single();
        
        if (error) {
          toast.error('Error adding contact: ' + error.message);
        } else {
          toast.success('Contact added successfully');
          
          // Create default documents for this contact
          if (insertedContact) {
            await supabase.rpc('create_default_documents_for_contact', {
              p_lead_id: selectedLead.id,
              p_contact_id: insertedContact.id,
              p_relationship: newContact.relationship
            });
          }
          
          setShowAddContactModal(false);
          setNewContact({
            name: '',
            email: '',
            phone: '',
            relationship: 'other',
            birth_date: '',
            birth_place: '',
            current_address: '',
            citizenship: '',
            passport_number: '',
            id_number: '',
            is_persecuted: false,
            contact_notes: ''
          });
          setSelectedLead(null);
          await fetchContacts();
        }
      } catch (err) {
        toast.error('Failed to add contact');
        console.error('Error adding contact:', err);
      }
    };
  
    // Update contact
    const updateContact = async () => {
      if (!editingContact) return;
  
      try {
        const { error } = await supabase
          .from('contacts')
          .update({
            name: editingContact.name,
            email: editingContact.email,
            phone: editingContact.phone,
            relationship: editingContact.relationship,
            birth_date: editingContact.birth_date,
            birth_place: editingContact.birth_place,
            current_address: editingContact.current_address,
            citizenship: editingContact.citizenship,
            passport_number: editingContact.passport_number,
            id_number: editingContact.id_number,
            is_persecuted: editingContact.is_persecuted,
            contact_notes: editingContact.contact_notes,
            is_main_applicant: editingContact.relationship === 'persecuted_person'
          })
          .eq('id', editingContact.id);
        
        if (error) {
          toast.error('Error updating contact: ' + error.message);
        } else {
          toast.success('Contact updated successfully');
          setEditingContact(null);
          await fetchContacts();
        }
      } catch (err) {
        toast.error('Failed to update contact');
      }
    };
  
    // Delete contact
    const deleteContact = async (contactId: string) => {
      if (!confirm('Are you sure you want to delete this contact? This will also delete all associated documents and history.')) return;
  
      try {
        const { error } = await supabase
          .from('contacts')
          .delete()
          .eq('id', contactId);
        
        if (error) {
          toast.error('Error deleting contact: ' + error.message);
        } else {
          toast.success('Contact deleted successfully');
          await fetchContacts();
        }
      } catch (err) {
        toast.error('Failed to delete contact');
      }
    };
  
    // Get relationship badge color
    const getRelationshipBadgeColor = (relationship: string) => {
      switch (relationship) {
        case 'persecuted_person': return 'badge-primary';
        case 'spouse': return 'badge-secondary';
        case 'child': return 'badge-accent';
        case 'parent': return 'badge-info';
        case 'sibling': return 'badge-warning';
        case 'grandchild': case 'grandson': case 'granddaughter': return 'badge-success';
        case 'grandparent': return 'badge-info badge-outline';
        case 'great_grandchild': case 'great_grandson': case 'great_granddaughter': return 'badge-success badge-outline';
        case 'great_grandparent': return 'badge-ghost';
        case 'nephew': case 'niece': case 'cousin': return 'badge-warning badge-outline';
        case 'uncle': case 'aunt': case 'in_law': return 'badge-secondary badge-outline';
        default: return 'badge-neutral';
      }
    };
  
    // Get document status color
    const getDocumentStatusColor = (percentage: number) => {
      return 'text-white bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600';
    };
  
    // Group contacts by lead
    const contactsByLead = contacts.reduce((acc, contact) => {
      if (!acc[contact.lead_id]) {
        acc[contact.lead_id] = [];
      }
      acc[contact.lead_id].push(contact);
      return acc;
    }, {} as Record<string, Contact[]>);
  
    if (loading) {
      return (
        <div className="text-center py-16 px-8">
          <div className="loading loading-spinner loading-lg text-blue-600 mb-4"></div>
          <p className="text-lg text-gray-600">Loading contacts...</p>
        </div>
      );
    }
  
    return (
      <div className="w-full px-2 sm:px-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6 sm:mb-8">
          <div>
            <h3 className="text-lg sm:text-xl font-bold text-gray-900">Applicants & Family Management</h3>
            <p className="text-sm sm:text-base text-gray-600">Manage persecuted persons and their family members for all cases</p>
          </div>
          <button 
            className="btn btn-primary gap-2 text-sm sm:text-base"
            onClick={() => setShowAddContactModal(true)}
          >
            <UserPlusIcon className="w-4 h-4" />
            Add Applicant
          </button>
        </div>
  
        {leads.length === 0 ? (
          <div className="text-center py-16 px-8 text-gray-500">
            <UserGroupIcon className="w-16 h-16 mx-auto mb-4 text-gray-300" />
            <p className="text-lg font-medium mb-1">No cases to manage contacts</p>
          </div>
        ) : (
          <div className="w-full">
            {leads.map((lead) => {
              const leadContacts = contactsByLead[lead.id] || [];
              
              return (
                <div key={lead.id} className="w-full bg-white rounded-2xl p-3 sm:p-8 shadow-lg border border-gray-200 mb-4 sm:mb-8">
                  <div className="flex items-center justify-between mb-4 sm:mb-6">
                    <div>
                      <h4 className="text-base sm:text-lg font-bold text-gray-900">{lead.name}</h4>
                      <p className="text-blue-600 font-medium text-sm sm:text-base">Lead #{lead.lead_number}</p>
                      <p className="text-xs sm:text-sm text-gray-500">{leadContacts.length} family member(s)</p>
                    </div>
                    <button
                      className="btn btn-outline btn-xs sm:btn-sm text-xs sm:text-sm"
                      onClick={() => {
                        setSelectedLead(lead);
                        setShowAddContactModal(true);
                      }}
                    >
                      <UserPlusIcon className="w-3 h-3 sm:w-4 sm:h-4" />
                      Add Family Member
                    </button>
                  </div>
  
                  {/* Contacts Grid */}
                  {leadContacts.length === 0 ? (
                    <div className="text-center py-16 px-8 text-gray-500">
                      <UserGroupIcon className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                      <p className="text-sm">No family members added yet</p>
                      <p className="text-xs text-gray-400">Click "Add Family Member" to get started</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-6">
                      {leadContacts.map((contact) => (
                        <div key={contact.id} className="bg-white rounded-xl shadow-lg border border-gray-200 hover:shadow-xl transition-all duration-300 ease-in-out transform hover:-translate-y-1 group flex flex-col h-full">
                          <div className="card-body p-3 sm:p-5 flex flex-col h-full">
                            <div className="flex justify-between items-start mb-2">
                              <h2 className="card-title text-base sm:text-xl font-bold group-hover:text-primary transition-colors">
                                {contact.name}
                              </h2>
                              <div className="flex gap-1 sm:gap-2">
                                <button 
                                  className="btn btn-ghost text-purple-600 hover:bg-purple-600 hover:text-white btn-xs sm:btn-sm"
                                  onClick={() => setEditingContact(contact)}
                                >
                                  <PencilIcon className="w-4 h-4 sm:w-5 sm:h-5" />
                                </button>
                                <button 
                                  className="btn btn-ghost text-purple-600 hover:bg-purple-600 hover:text-white btn-xs sm:btn-sm"
                                  onClick={() => deleteContact(contact.id)}
                                >
                                  <TrashIcon className="w-4 h-4 sm:w-5 sm:h-5" />
                                </button>
                              </div>
                            </div>
                            
                            <div className="flex flex-wrap gap-1 mb-3 sm:mb-4">
                              <span className="badge badge-xs sm:badge-sm bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-none">
                                {contact.relationship.replace('_', ' ')}
                              </span>
                              {contact.is_main_applicant && (
                                <span className="badge badge-xs sm:badge-sm bg-gradient-to-r from-blue-500 to-blue-600 text-white border-none">
                                  Main
                                </span>
                              )}
                              {contact.is_persecuted && (
                                <span className="badge badge-xs sm:badge-sm bg-gradient-to-r from-red-500 to-red-600 text-white border-none">
                                  Persecuted
                                </span>
                              )}
                            </div>
  
                            <div className="divider my-0"></div>
  
                            {/* Contact Info Grid */}
                            <div className="grid grid-cols-2 gap-x-2 sm:gap-x-4 gap-y-2 sm:gap-y-3 mt-3 sm:mt-4 flex-grow">
                              {contact.email && (
                                <div className="flex flex-col gap-1">
                                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Email</span>
                                  <span className="text-xs sm:text-sm font-medium truncate" title={contact.email}>
                                    {contact.email}
                                  </span>
                                </div>
                              )}
                              {contact.phone && (
                                <div className="flex flex-col gap-1">
                                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Phone</span>
                                  <span className="text-xs sm:text-sm font-medium">{contact.phone}</span>
                                </div>
                              )}
                              {contact.birth_date && (
                                <div className="flex flex-col gap-1">
                                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Birth Date</span>
                                  <span className="text-xs sm:text-sm font-medium">{new Date(contact.birth_date).toLocaleDateString()}</span>
                                </div>
                              )}
                              {contact.citizenship && (
                                <div className="flex flex-col gap-1">
                                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Citizenship</span>
                                  <span className="text-xs sm:text-sm font-medium">{contact.citizenship}</span>
                                </div>
                              )}
                              {contact.birth_place && (
                                <div className="flex flex-col gap-1">
                                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Birth Place</span>
                                  <span className="text-xs sm:text-sm font-medium">{contact.birth_place}</span>
                                </div>
                              )}
                              {contact.current_address && (
                                <div className="flex flex-col gap-1">
                                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Address</span>
                                  <span className="text-xs sm:text-sm font-medium">{contact.current_address}</span>
                                </div>
                              )}
                              {contact.passport_number && (
                                <div className="flex flex-col gap-1">
                                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Passport</span>
                                  <span className="text-xs sm:text-sm font-medium">{contact.passport_number}</span>
                                </div>
                              )}
                              {contact.id_number && (
                                <div className="flex flex-col gap-1">
                                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">ID Number</span>
                                  <span className="text-xs sm:text-sm font-medium">{contact.id_number}</span>
                                </div>
                              )}
                            </div>
  
                            {/* Document Status - Always at bottom */}
                            <div className="mt-auto pt-3 sm:pt-4 border-t border-base-200/50">
                              <div className="flex flex-col gap-2">
                                <div className="flex justify-between items-center">
                                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Documents</span>
                                  <span className="text-xs sm:text-sm font-bold">
                                    {contact.completed_documents || 0}/{contact.document_count || 0}
                                  </span>
                                </div>
                                
                                                               <div className="flex items-center gap-3">
                                   <div className="flex-1">
                                     <progress 
                                       className="progress progress-primary w-full h-2" 
                                       value={contact.completion_percentage || 0} 
                                       max="100"
                                     ></progress>
                                   </div>
                                   <span className={`badge border-none text-white ${getDocumentStatusColor(contact.completion_percentage || 0)}`}>
                                     {contact.completion_percentage || 0}%
                                   </span>
                                 </div>
                              </div>
                              
  
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
  
        {/* Add Contact Modal */}
        {showAddContactModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30">
            <div className="bg-white rounded-2xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold">Add Applicant</h3>
                <button 
                  onClick={() => {
                    setShowAddContactModal(false);
                    setSelectedLead(null);
                  }}
                  className="btn btn-ghost btn-circle btn-sm"
                >
                  <XMarkIcon className="w-5 h-5" />
                </button>
              </div>
  
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {!selectedLead && (
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Case *</label>
                    <select
                      className="select select-bordered w-full"
                      value={selectedLead ? (selectedLead as HandlerLead).id : ''}
                      onChange={(e) => {
                        const lead = leads.find((l: HandlerLead) => l.id === e.target.value);
                        setSelectedLead(lead || null);
                      }}
                    >
                      <option value="">Select a case...</option>
                      {leads.map(lead => (
                        <option key={lead.id} value={lead.id}>
                          {lead.name} - #{lead.lead_number}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
  
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
                  <input
                    type="text"
                    className="input input-bordered w-full"
                    value={newContact.name}
                    onChange={(e) => setNewContact(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="Enter full name..."
                  />
                </div>
  
                                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Relationship to Persecuted Person *</label>
                    <select
                      className="select select-bordered w-full"
                      value={newContact.relationship}
                      onChange={(e) => setNewContact(prev => ({ ...prev, relationship: e.target.value as Contact['relationship'] }))}
                    >
                      <option value="persecuted_person">Persecuted Person</option>
                      <option value="spouse">Spouse</option>
                      <option value="child">Child</option>
                      <option value="parent">Parent</option>
                      <option value="sibling">Sibling</option>
                      <option value="grandchild">Grandchild</option>
                      <option value="grandson">Grandson</option>
                      <option value="granddaughter">Granddaughter</option>
                      <option value="grandparent">Grandparent</option>
                      <option value="great_grandchild">Great Grandchild</option>
                      <option value="great_grandson">Great Grandson</option>
                      <option value="great_granddaughter">Great Granddaughter</option>
                      <option value="great_grandparent">Great Grandparent</option>
                      <option value="nephew">Nephew</option>
                      <option value="niece">Niece</option>
                      <option value="cousin">Cousin</option>
                      <option value="uncle">Uncle</option>
                      <option value="aunt">Aunt</option>
                      <option value="in_law">In-Law</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
  
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                  <input
                    type="email"
                    className="input input-bordered w-full"
                    value={newContact.email}
                    onChange={(e) => setNewContact(prev => ({ ...prev, email: e.target.value }))}
                    placeholder="email@example.com"
                  />
                </div>
  
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                  <input
                    type="tel"
                    className="input input-bordered w-full"
                    value={newContact.phone}
                    onChange={(e) => setNewContact(prev => ({ ...prev, phone: e.target.value }))}
                    placeholder="+1234567890"
                  />
                </div>
  
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Birth Date</label>
                  <input
                    type="date"
                    className="input input-bordered w-full"
                    value={newContact.birth_date}
                    onChange={(e) => setNewContact(prev => ({ ...prev, birth_date: e.target.value }))}
                  />
                </div>
  
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Birth Place</label>
                  <input
                    type="text"
                    className="input input-bordered w-full"
                    value={newContact.birth_place}
                    onChange={(e) => setNewContact(prev => ({ ...prev, birth_place: e.target.value }))}
                    placeholder="City, Country"
                  />
                </div>
  
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Citizenship</label>
                  <input
                    type="text"
                    className="input input-bordered w-full"
                    value={newContact.citizenship}
                    onChange={(e) => setNewContact(prev => ({ ...prev, citizenship: e.target.value }))}
                    placeholder="Country"
                  />
                </div>
  
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Passport Number</label>
                  <input
                    type="text"
                    className="input input-bordered w-full"
                    value={newContact.passport_number}
                    onChange={(e) => setNewContact(prev => ({ ...prev, passport_number: e.target.value }))}
                    placeholder="Passport number"
                  />
                </div>
  
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Current Address</label>
                  <textarea
                    className="textarea textarea-bordered w-full h-20 resize-none"
                    value={newContact.current_address}
                    onChange={(e) => setNewContact(prev => ({ ...prev, current_address: e.target.value }))}
                    placeholder="Current address..."
                  />
                </div>
  
                <div className="md:col-span-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="checkbox checkbox-primary"
                      checked={newContact.is_persecuted}
                      onChange={(e) => setNewContact(prev => ({ ...prev, is_persecuted: e.target.checked }))}
                    />
                    <label className="text-sm font-medium text-gray-700">Subject to persecution</label>
                  </div>
                </div>
  
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                  <textarea
                    className="textarea textarea-bordered w-full h-20 resize-none"
                    value={newContact.contact_notes}
                    onChange={(e) => setNewContact(prev => ({ ...prev, contact_notes: e.target.value }))}
                    placeholder="Additional notes about this family member..."
                  />
                </div>
              </div>
  
              <div className="flex gap-3 mt-6">
                <button 
                  className="btn btn-outline flex-1"
                  onClick={() => {
                    setShowAddContactModal(false);
                    setSelectedLead(null);
                  }}
                >
                  Cancel
                </button>
                <button 
                  className="btn btn-primary flex-1"
                  onClick={addContact}
                >
                  Add Family Member
                </button>
              </div>
            </div>
          </div>
        )}
  
        {/* Edit Contact Modal */}
        {editingContact && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30">
            <div className="bg-white rounded-2xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold">Edit Family Member</h3>
                <button 
                  onClick={() => setEditingContact(null)}
                  className="btn btn-ghost btn-circle btn-sm"
                >
                  <XMarkIcon className="w-5 h-5" />
                </button>
              </div>
  
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                  <input
                    type="text"
                    className="input input-bordered w-full"
                    value={editingContact.name}
                    onChange={(e) => setEditingContact(prev => prev ? ({ ...prev, name: e.target.value }) : null)}
                  />
                </div>
  
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Relationship</label>
                  <select
                    className="select select-bordered w-full"
                    value={editingContact.relationship}
                    onChange={(e) => setEditingContact(prev => prev ? ({ ...prev, relationship: e.target.value as Contact['relationship'] }) : null)}
                  >
                    <option value="main_applicant">Main Applicant</option>
                    <option value="spouse">Spouse</option>
                    <option value="child">Child</option>
                    <option value="parent">Parent</option>
                    <option value="sibling">Sibling</option>
                    <option value="other">Other</option>
                  </select>
                </div>
  
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                  <input
                    type="email"
                    className="input input-bordered w-full"
                    value={editingContact.email || ''}
                    onChange={(e) => setEditingContact(prev => prev ? ({ ...prev, email: e.target.value }) : null)}
                  />
                </div>
  
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                  <input
                    type="tel"
                    className="input input-bordered w-full"
                    value={editingContact.phone || ''}
                    onChange={(e) => setEditingContact(prev => prev ? ({ ...prev, phone: e.target.value }) : null)}
                  />
                </div>
  
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Birth Date</label>
                  <input
                    type="date"
                    className="input input-bordered w-full"
                    value={editingContact.birth_date ? editingContact.birth_date.split('T')[0] : ''}
                    onChange={(e) => setEditingContact(prev => prev ? ({ ...prev, birth_date: e.target.value }) : null)}
                  />
                </div>
  
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Birth Place</label>
                  <input
                    type="text"
                    className="input input-bordered w-full"
                    value={editingContact.birth_place || ''}
                    onChange={(e) => setEditingContact(prev => prev ? ({ ...prev, birth_place: e.target.value }) : null)}
                  />
                </div>
  
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Citizenship</label>
                  <input
                    type="text"
                    className="input input-bordered w-full"
                    value={editingContact.citizenship || ''}
                    onChange={(e) => setEditingContact(prev => prev ? ({ ...prev, citizenship: e.target.value }) : null)}
                  />
                </div>
  
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Passport Number</label>
                  <input
                    type="text"
                    className="input input-bordered w-full"
                    value={editingContact.passport_number || ''}
                    onChange={(e) => setEditingContact(prev => prev ? ({ ...prev, passport_number: e.target.value }) : null)}
                  />
                </div>
  
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Current Address</label>
                  <textarea
                    className="textarea textarea-bordered w-full h-20 resize-none"
                    value={editingContact.current_address || ''}
                    onChange={(e) => setEditingContact(prev => prev ? ({ ...prev, current_address: e.target.value }) : null)}
                  />
                </div>
  
                <div className="md:col-span-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="checkbox checkbox-primary"
                      checked={editingContact.is_persecuted}
                      onChange={(e) => setEditingContact(prev => prev ? ({ ...prev, is_persecuted: e.target.checked }) : null)}
                    />
                    <label className="text-sm font-medium text-gray-700">Subject to persecution</label>
                  </div>
                </div>
  
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                  <textarea
                    className="textarea textarea-bordered w-full h-20 resize-none"
                    value={editingContact.contact_notes || ''}
                    onChange={(e) => setEditingContact(prev => prev ? ({ ...prev, contact_notes: e.target.value }) : null)}
                  />
                </div>
              </div>
  
              <div className="flex gap-3 mt-6">
                <button 
                  className="btn btn-outline flex-1"
                  onClick={() => setEditingContact(null)}
                >
                  Cancel
                </button>
                <button 
                  className="btn btn-primary flex-1"
                  onClick={updateContact}
                >
                  Update Family Member
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };
  

export default ContactsTab; 