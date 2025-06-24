import React, { useState, useEffect } from 'react';
import { ClientTabProps } from '../../types/client';
import { UserIcon, PhoneIcon, EnvelopeIcon, PlusIcon, DocumentTextIcon, XMarkIcon, PencilSquareIcon, CheckIcon, TrashIcon } from '@heroicons/react/24/outline';
import { supabase } from '../../lib/supabase';

interface ContactEntry {
  id: number;
  name: string;
  mobile: string;
  phone: string;
  email: string;
  isMain?: boolean;
  isEditing?: boolean;
}

const ContactInfoTab: React.FC<ClientTabProps> = ({ client, onClientUpdate }) => {
  const [contacts, setContacts] = useState<ContactEntry[]>([
    {
      id: 1,
      name: client.name || '---',
      mobile: client.mobile || '---',
      phone: client.phone || '---',
      email: client.email || '---',
      isMain: true,
    }
  ]);

  const [isEditingMainContact, setIsEditingMainContact] = useState(false);
  const [editedMainContact, setEditedMainContact] = useState({
    name: client.name || '',
    mobile: client.mobile || '',
    phone: client.phone || '',
    email: client.email || ''
  });

  // Update contacts when client data changes
  useEffect(() => {
    const mainContact: ContactEntry = {
      id: 1,
      name: client.name || '---',
      mobile: client.mobile || '---',
      phone: client.phone || '---',
      email: client.email || '---',
      isMain: true,
    };

    const additionalContacts = client.additional_contacts || [];
    const additionalContactEntries: ContactEntry[] = additionalContacts.map((contact: any, index: number) => ({
      id: index + 2,
      name: contact.name || '---',
      mobile: contact.mobile || '---',
      phone: contact.phone || '---',
      email: contact.email || '---',
      isMain: false,
    }));

    setContacts([mainContact, ...additionalContactEntries]);
    setEditedMainContact({
      name: client.name || '',
      mobile: client.mobile || '',
      phone: client.phone || '',
      email: client.email || ''
    });
  }, [client]);

  const handleCreateNewContact = () => {
    const newContact: ContactEntry = {
      id: Date.now(),
      name: '',
      mobile: '',
      phone: '',
      email: '',
      isEditing: true,
    };
    setContacts([...contacts, newContact]);
  };

  const handleSaveMainContact = async () => {
    try {
      const { error } = await supabase
        .from('leads')
        .update({
          name: editedMainContact.name,
          mobile: editedMainContact.mobile,
          phone: editedMainContact.phone,
          email: editedMainContact.email
        })
        .eq('id', client.id);

      if (error) throw error;

      setIsEditingMainContact(false);
      
      // Refresh client data in parent component
      if (onClientUpdate) {
        await onClientUpdate();
      }
    } catch (error) {
      console.error('Error updating main contact:', error);
      alert('Failed to update contact information');
    }
  };

  const handleCancelMainContact = () => {
    setEditedMainContact({
      name: client.name || '',
      mobile: client.mobile || '',
      phone: client.phone || '',
      email: client.email || ''
    });
    setIsEditingMainContact(false);
  };

  const handleSaveContact = async (id: number, contact: ContactEntry) => {
    if (contact.isMain) {
      await handleSaveMainContact();
      return;
    }

    try {
      // Update additional contacts
      const additionalContacts = contacts.filter(c => !c.isMain && c.id !== id);
      const updatedAdditionalContacts = [...additionalContacts, {
        name: contact.name,
        mobile: contact.mobile,
        phone: contact.phone,
        email: contact.email
      }];

      const { error } = await supabase
        .from('leads')
        .update({ additional_contacts: updatedAdditionalContacts })
        .eq('id', client.id);

      if (error) throw error;

      setContacts(contacts.map(c => 
        c.id === id ? { ...contact, isEditing: false } : c
      ));
      
      // Refresh client data in parent component
      if (onClientUpdate) {
        await onClientUpdate();
      }
    } catch (error) {
      console.error('Error updating contact:', error);
      alert('Failed to update contact');
    }
  };

  const handleDeleteContact = async (id: number) => {
    if (contacts.find(c => c.id === id)?.isMain) {
      alert('Cannot delete the main contact');
      return;
    }

    try {
      const additionalContacts = contacts
        .filter(c => !c.isMain && c.id !== id)
        .map(c => ({
          name: c.name,
          mobile: c.mobile,
          phone: c.phone,
          email: c.email
        }));

      const { error } = await supabase
        .from('leads')
        .update({ additional_contacts: additionalContacts })
        .eq('id', client.id);

      if (error) throw error;

      setContacts(contacts.filter(c => c.id !== id));
      
      // Refresh client data in parent component
      if (onClientUpdate) {
        await onClientUpdate();
      }
    } catch (error) {
      console.error('Error deleting contact:', error);
      alert('Failed to delete contact');
    }
  };

  return (
    <div className="w-full overflow-x-hidden">
      <div className="p-4 md:p-6">
        <div className="flex items-center gap-4 mb-6">
          <div className="flex items-center gap-2">
            <UserIcon className="w-6 h-6 text-primary" />
            <h3 className="text-2xl font-semibold">Contact Info</h3>
          </div>
          <button 
            className="btn btn-sm text-white gap-2" 
            style={{ backgroundColor: '#6366f1' }}
            onClick={handleCreateNewContact}
          >
            <PlusIcon className="w-4 h-4" />
            Add Contact
          </button>
        </div>

        <div className="card bg-base-100 shadow-lg relative">
          <div className="card-body p-4 md:p-6">
            {contacts.map((contact, index) => (
              <div key={contact.id} className={`${index > 0 ? 'mt-8 pt-8 border-t' : ''}`}>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-6">
                  {/* Name Section */}
                  <div className="space-y-3">
                    <h4 className="text-lg font-semibold">Name</h4>
                    {contact.isMain && isEditingMainContact ? (
                      <div className="space-y-2">
                        <input
                          type="text"
                          placeholder="Enter name"
                          className="input input-bordered w-full"
                          value={editedMainContact.name}
                          onChange={(e) => setEditedMainContact({
                            ...editedMainContact,
                            name: e.target.value
                          })}
                        />
                        <div className="flex gap-2">
                          <button 
                            className="btn btn-success btn-sm flex-1"
                            onClick={handleSaveMainContact}
                          >
                            <CheckIcon className="w-4 h-4" />
                            Save
                          </button>
                          <button 
                            className="btn btn-error btn-sm flex-1"
                            onClick={handleCancelMainContact}
                          >
                            <XMarkIcon className="w-4 h-4" />
                            Cancel
                          </button>
                          <button
                            className="btn btn-ghost btn-sm flex-1"
                            onClick={() => {
                              if (window.confirm('Are you sure you want to delete this contact?')) {
                                handleDeleteContact(contact.id);
                              }
                            }}
                          >
                            <TrashIcon className="w-4 h-4 text-error" />
                          </button>
                        </div>
                      </div>
                    ) : contact.isEditing ? (
                      <div className="space-y-2">
                        <input
                          type="text"
                          placeholder="Enter name"
                          className="input input-bordered w-full"
                          value={contact.name}
                          onChange={(e) => setContacts(contacts.map(c =>
                            c.id === contact.id ? { ...c, name: e.target.value } : c
                          ))}
                        />
                        <div className="flex gap-2">
                          <button 
                            className="btn btn-success btn-sm flex-1"
                            onClick={() => handleSaveContact(contact.id, contact)}
                          >
                            Save
                          </button>
                          <button 
                            className="btn btn-error btn-sm flex-1"
                            onClick={() => setContacts(contacts.map(c => c.id === contact.id ? { ...c, isEditing: false } : c))}
                          >
                            <XMarkIcon className="w-4 h-4" />
                            Cancel
                          </button>
                          <button 
                            className="btn btn-ghost btn-sm flex-1"
                            onClick={() => {
                              if (window.confirm('Are you sure you want to delete this contact?')) {
                                handleDeleteContact(contact.id);
                              }
                            }}
                          >
                            <TrashIcon className="w-4 h-4 text-error" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="text-primary text-lg">{contact.name}</span>
                        {contact.isMain && (
                          <>
                            <span className="badge badge-neutral">Main</span>
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Mobile Section */}
                  <div className="space-y-3">
                    <h4 className="text-lg font-semibold">Mobile</h4>
                    {contact.isMain && isEditingMainContact ? (
                      <input
                        type="tel"
                        placeholder="Enter mobile"
                        className="input input-bordered w-full"
                        value={editedMainContact.mobile}
                        onChange={(e) => setEditedMainContact({
                          ...editedMainContact,
                          mobile: e.target.value
                        })}
                      />
                    ) : contact.isEditing ? (
                      <input
                        type="tel"
                        placeholder="Enter mobile"
                        className="input input-bordered w-full"
                        value={contact.mobile}
                        onChange={(e) => setContacts(contacts.map(c =>
                          c.id === contact.id ? { ...c, mobile: e.target.value } : c
                        ))}
                      />
                    ) : (
                      <div className="text-lg">{contact.mobile}</div>
                    )}
                  </div>

                  {/* Phone Section */}
                  <div className="space-y-3">
                    <h4 className="text-lg font-semibold">Phone</h4>
                    {contact.isMain && isEditingMainContact ? (
                      <input
                        type="tel"
                        placeholder="Enter phone"
                        className="input input-bordered w-full"
                        value={editedMainContact.phone}
                        onChange={(e) => setEditedMainContact({
                          ...editedMainContact,
                          phone: e.target.value
                        })}
                      />
                    ) : contact.isEditing ? (
                      <input
                        type="tel"
                        placeholder="Enter phone"
                        className="input input-bordered w-full"
                        value={contact.phone}
                        onChange={(e) => setContacts(contacts.map(c =>
                          c.id === contact.id ? { ...c, phone: e.target.value } : c
                        ))}
                      />
                    ) : contact.phone && contact.phone !== '---' ? (
                      <a 
                        href={`tel:${contact.phone}`} 
                        className="text-lg text-primary hover:underline flex items-center gap-2"
                      >
                        <PhoneIcon className="w-5 h-5" />
                        {contact.phone}
                      </a>
                    ) : (
                      <div className="text-lg">{contact.phone}</div>
                    )}
                  </div>

                  {/* Email Section */}
                  <div className="space-y-3">
                    <h4 className="text-lg font-semibold">Email</h4>
                    {contact.isMain && isEditingMainContact ? (
                      <input
                        type="email"
                        placeholder="Enter email"
                        className="input input-bordered w-full"
                        value={editedMainContact.email}
                        onChange={(e) => setEditedMainContact({
                          ...editedMainContact,
                          email: e.target.value
                        })}
                      />
                    ) : contact.isEditing ? (
                      <input
                        type="email"
                        placeholder="Enter email"
                        className="input input-bordered w-full"
                        value={contact.email}
                        onChange={(e) => setContacts(contacts.map(c =>
                          c.id === contact.id ? { ...c, email: e.target.value } : c
                        ))}
                      />
                    ) : contact.email && contact.email !== '---' ? (
                      <a 
                        href={`mailto:${contact.email}`} 
                        className="text-lg text-primary hover:underline flex items-center gap-2 break-all"
                      >
                        <EnvelopeIcon className="w-5 h-5 flex-shrink-0" />
                        {contact.email}
                      </a>
                    ) : (
                      <div className="text-lg">{contact.email}</div>
                    )}
                  </div>

                  {/* Contract Section */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <DocumentTextIcon className="w-5 h-5 text-base-content/70" />
                        <h4 className="text-lg font-semibold">Contract</h4>
                      </div>
                      <button 
                        className="btn btn-square btn-sm"
                        style={{ backgroundColor: '#000000', color: 'white' }}
                        onClick={() => contact.isMain ? setIsEditingMainContact(true) : setContacts(contacts.map(c => 
                          c.id === contact.id ? { ...c, isEditing: true } : c
                        ))}
                      >
                        <PencilSquareIcon className="w-4 h-4" />
                      </button>
                    </div>
                    <button className="btn gap-2 text-white" style={{ backgroundColor: '#6366f1' }}>
                      <PlusIcon className="w-5 h-5" />
                      Add
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ContactInfoTab; 