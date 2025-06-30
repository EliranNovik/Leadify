import React, { useState, useEffect, Fragment } from 'react';
import { ClientTabProps } from '../../types/client';
import { UserIcon, PhoneIcon, EnvelopeIcon, PlusIcon, DocumentTextIcon, XMarkIcon, PencilSquareIcon, CheckIcon, TrashIcon } from '@heroicons/react/24/outline';
import { supabase } from '../../lib/supabase';
import { createPortal } from 'react-dom';

interface ContactEntry {
  id: number;
  name: string;
  mobile: string;
  phone: string;
  email: string;
  isMain?: boolean;
  isEditing?: boolean;
}

const CONTRACT_TEMPLATES = [
  'German Citizenship without Archival Check',
  'Austrian Citizenship without Archival Check',
  'Aliyah to Israel',
  'US Greencard',
];

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

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerContactId, setDrawerContactId] = useState<number | null>(null);
  const [contactContracts, setContactContracts] = useState<{ [id: number]: string }>({});

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

  // Drawer open handler
  const openContractDrawer = (contactId: number) => {
    setDrawerContactId(contactId);
    setDrawerOpen(true);
  };
  const closeContractDrawer = () => {
    setDrawerOpen(false);
    setDrawerContactId(null);
  };
  // Select contract template
  const handleSelectContract = (template: string) => {
    if (drawerContactId !== null) {
      setContactContracts(prev => ({ ...prev, [drawerContactId]: template }));
      closeContractDrawer();
    }
  };

  return (
    <Fragment>
      <div className="w-full overflow-x-hidden">
        <div className="p-4 md:p-6">
          <div className="flex items-center gap-4 mb-6">
            <div className="flex items-center gap-2">
              <UserIcon className="w-6 h-6 text-primary" />
              <h3 className="text-2xl font-semibold">Contact Info</h3>
            </div>
            <button 
              className="btn btn-outline btn-sm gap-2" 
              onClick={handleCreateNewContact}
            >
              <PlusIcon className="w-4 h-4" />
              Add Contact
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-12 w-full items-start pb-6">
            {contacts.map((contact, index) => (
              <div key={contact.id} className="flex flex-col gap-4 w-full h-full min-h-[500px] items-start bg-transparent">
                {/* Name (with main badge if main) */}
                <div className={`w-full bg-white/90 rounded-xl shadow p-4 flex flex-col gap-1 flex-1 ${contact.isMain ? 'border-l-4 border-primary pl-4' : ''}`}> 
                  <div className="flex items-center gap-2 mb-1">
                    <UserIcon className="w-5 h-5 text-primary/70" />
                    <span className="text-base font-bold uppercase tracking-wide">Name</span>
                    {contact.isMain && (
                      <span className="badge badge-primary ml-2">Main Contact</span>
                    )}
                  </div>
                  {contact.isMain && isEditingMainContact ? (
                    <input
                      type="text"
                      placeholder="Enter name"
                      className="input input-bordered w-full"
                      value={editedMainContact.name}
                      onChange={(e) => setEditedMainContact({ ...editedMainContact, name: e.target.value })}
                    />
                  ) : contact.isEditing ? (
                    <input
                      type="text"
                      placeholder="Enter name"
                      className="input input-bordered w-full"
                      value={contact.name}
                      onChange={(e) => setContacts(contacts.map(c => c.id === contact.id ? { ...c, name: e.target.value } : c))}
                    />
                  ) : (
                    <span className="text-lg font-semibold text-primary">{contact.name}</span>
                  )}
                </div>
                {/* Mobile */}
                <div className="w-full bg-white/90 rounded-xl shadow p-4 flex flex-col gap-1 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <PhoneIcon className="w-5 h-5 text-primary/70" />
                    <span className="text-base font-bold uppercase tracking-wide">Mobile</span>
                  </div>
                  {contact.isMain && isEditingMainContact ? (
                    <input
                      type="tel"
                      placeholder="Enter mobile"
                      className="input input-bordered w-full"
                      value={editedMainContact.mobile}
                      onChange={(e) => setEditedMainContact({ ...editedMainContact, mobile: e.target.value })}
                    />
                  ) : contact.isEditing ? (
                    <input
                      type="tel"
                      placeholder="Enter mobile"
                      className="input input-bordered w-full"
                      value={contact.mobile}
                      onChange={(e) => setContacts(contacts.map(c => c.id === contact.id ? { ...c, mobile: e.target.value } : c))}
                    />
                  ) : (
                    <span className="text-lg">{contact.mobile}</span>
                  )}
                </div>
                {/* Phone */}
                <div className="w-full bg-white/90 rounded-xl shadow p-4 flex flex-col gap-1 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <PhoneIcon className="w-5 h-5 text-primary/70" />
                    <span className="text-base font-bold uppercase tracking-wide">Phone</span>
                  </div>
                  {contact.isMain && isEditingMainContact ? (
                    <input
                      type="tel"
                      placeholder="Enter phone"
                      className="input input-bordered w-full"
                      value={editedMainContact.phone}
                      onChange={(e) => setEditedMainContact({ ...editedMainContact, phone: e.target.value })}
                    />
                  ) : contact.isEditing ? (
                    <input
                      type="tel"
                      placeholder="Enter phone"
                      className="input input-bordered w-full"
                      value={contact.phone}
                      onChange={(e) => setContacts(contacts.map(c => c.id === contact.id ? { ...c, phone: e.target.value } : c))}
                    />
                  ) : contact.phone && contact.phone !== '---' ? (
                    <a href={`tel:${contact.phone}`} className="text-lg text-primary hover:underline flex items-center gap-2">
                      <PhoneIcon className="w-5 h-5" />
                      {contact.phone}
                    </a>
                  ) : (
                    <span className="text-lg">{contact.phone}</span>
                  )}
                </div>
                {/* Email */}
                <div className="w-full bg-white/90 rounded-xl shadow p-4 flex flex-col gap-1 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <EnvelopeIcon className="w-5 h-5 text-primary/70" />
                    <span className="text-base font-bold uppercase tracking-wide">Email</span>
                  </div>
                  {contact.isMain && isEditingMainContact ? (
                    <input
                      type="email"
                      placeholder="Enter email"
                      className="input input-bordered w-full"
                      value={editedMainContact.email}
                      onChange={(e) => setEditedMainContact({ ...editedMainContact, email: e.target.value })}
                    />
                  ) : contact.isEditing ? (
                    <input
                      type="email"
                      placeholder="Enter email"
                      className="input input-bordered w-full"
                      value={contact.email}
                      onChange={(e) => setContacts(contacts.map(c => c.id === contact.id ? { ...c, email: e.target.value } : c))}
                    />
                  ) : contact.email && contact.email !== '---' ? (
                    <a href={`mailto:${contact.email}`} className="text-lg text-primary hover:underline flex items-center gap-2 break-all">
                      <EnvelopeIcon className="w-5 h-5 flex-shrink-0" />
                      {contact.email}
                    </a>
                  ) : (
                    <span className="text-lg">{contact.email}</span>
                  )}
                </div>
                {/* Contract */}
                <div className="w-full bg-white/90 rounded-xl shadow p-4 flex flex-col gap-1 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <DocumentTextIcon className="w-5 h-5 text-primary/70" />
                    <span className="text-base font-bold uppercase tracking-wide">Contract</span>
                  </div>
                  {contactContracts[contact.id] ? (
                    <div className="flex items-center gap-2 mt-2">
                      <span className="font-semibold text-primary">{contactContracts[contact.id]}</span>
                      <button className="btn btn-outline btn-xs ml-2" onClick={() => openContractDrawer(contact.id)}>
                        Edit Contract
                      </button>
                    </div>
                  ) : (
                    <button className="btn btn-outline btn-sm gap-2 mt-2" onClick={() => openContractDrawer(contact.id)}>
                      <PlusIcon className="w-5 h-5" />
                      Add Contract
                    </button>
                  )}
                </div>
                {/* Edit/Delete Controls */}
                <div className="flex flex-row gap-2 mt-2">
                  {(contact.isMain && !isEditingMainContact) || (!contact.isMain && !contact.isEditing) ? (
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => contact.isMain ? setIsEditingMainContact(true) : setContacts(contacts.map(c => c.id === contact.id ? { ...c, isEditing: true } : c))}
                    >
                      <PencilSquareIcon className="w-4 h-4" />
                      Edit
                    </button>
                  ) : null}
                  {((contact.isMain && isEditingMainContact) || contact.isEditing) && (
                    <>
                      <button
                        className="btn btn-success btn-sm"
                        onClick={() => contact.isMain ? handleSaveMainContact() : handleSaveContact(contact.id, contact)}
                      >
                        <CheckIcon className="w-4 h-4" />
                        Save
                      </button>
                      <button
                        className="btn btn-error btn-sm"
                        onClick={() => contact.isMain ? handleCancelMainContact() : setContacts(contacts.map(c => c.id === contact.id ? { ...c, isEditing: false } : c))}
                      >
                        <XMarkIcon className="w-4 h-4" />
                        Cancel
                      </button>
                    </>
                  )}
                  {!contact.isMain && (
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        if (window.confirm('Are you sure you want to delete this contact?')) {
                          handleDeleteContact(contact.id);
                        }
                      }}
                    >
                      <TrashIcon className="w-4 h-4 text-error" />
                      Delete
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      {/* Drawer UI rendered via portal */}
      {drawerOpen && typeof window !== 'undefined' && createPortal(
        <>
          {/* Overlay */}
          <div className="fixed inset-0 bg-black/30 transition-opacity duration-300 z-[9999]" onClick={closeContractDrawer} />
          {/* Drawer */}
          <div className="fixed top-0 right-0 h-screen w-full max-w-md bg-white shadow-2xl p-8 flex flex-col animate-slideInRight z-[10000]" style={{ minHeight: '100vh' }}>
            <button className="btn btn-ghost btn-circle absolute top-4 right-4" onClick={closeContractDrawer}>
              <XMarkIcon className="w-6 h-6" />
            </button>
            <h2 className="text-2xl font-bold mb-6">Select Contract Template</h2>
            <div className="flex flex-col gap-4">
              {CONTRACT_TEMPLATES.map(template => (
                <button
                  key={template}
                  className="btn btn-outline btn-lg text-left justify-start"
                  onClick={() => handleSelectContract(template)}
                >
                  {template}
                </button>
              ))}
            </div>
          </div>
        </>,
        document.body
      )}
    </Fragment>
  );
};

export default ContactInfoTab; 