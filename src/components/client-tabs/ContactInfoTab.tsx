import React, { useState, useEffect, Fragment } from 'react';
import { ClientTabProps } from '../../types/client';
import { UserIcon, PhoneIcon, EnvelopeIcon, PlusIcon, DocumentTextIcon, XMarkIcon, PencilSquareIcon, CheckIcon, TrashIcon } from '@heroicons/react/24/outline';
import { supabase } from '../../lib/supabase';
import { createPortal } from 'react-dom';
import SignaturePad from 'react-signature-canvas';
import TimelineHistoryButtons from './TimelineHistoryButtons';

interface ContactEntry {
  id: number;
  name: string;
  mobile: string;
  phone: string;
  email: string;
  isMain?: boolean;
  isEditing?: boolean;
}

interface ContractTemplate {
  id: string;
  name: string;
  content: any;
}

// Helper to render TipTap JSON as React elements, with support for dynamic fields in 'View as Client' mode
const renderTiptapContent = (content: any, keyPrefix = '', asClient = false, signaturePads?: { [key: string]: any }): React.ReactNode => {
  if (!content) return null;
  if (Array.isArray(content)) {
    return content.map((n, i) => renderTiptapContent(n, keyPrefix + '-' + i, asClient, signaturePads));
  }
  if (content.type === 'text') {
    let text = content.text;
    if (asClient && text) {
      // Split text by {{text}} and {{signature}} placeholders
      const parts = [];
      let lastIndex = 0;
      const regex = /({{text}}|{{signature}})/g;
      let match;
      let partIdx = 0;
      while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) {
          // Normal text before the placeholder
          const normalText = text.slice(lastIndex, match.index);
          parts.push(normalText);
        }
        // Placeholder
        if (match[1] === '{{text}}') {
          parts.push(
            <input
              key={keyPrefix + '-input-' + partIdx}
              className="input input-bordered input-sm mx-1"
              placeholder="Enter text"
              style={{ minWidth: 80, display: 'inline-block' }}
            />
          );
        } else if (match[1] === '{{signature}}') {
          parts.push(
            <span
              key={keyPrefix + '-sig-' + partIdx}
              style={{ display: 'inline-block', minWidth: 180, minHeight: 60, border: '1px solid #ccc', borderRadius: 8, background: '#f9f9f9', margin: '0 8px', verticalAlign: 'middle' }}
            >
              <SignaturePad
                ref={(ref) => {
                  if (ref && signaturePads) signaturePads[keyPrefix + '-sig-' + partIdx] = ref;
                }}
                penColor="#3b28c7"
                backgroundColor="#f9f9f9"
                canvasProps={{ width: 180, height: 60, style: { display: 'block', borderRadius: 8 } }}
              />
            </span>
          );
        }
        lastIndex = match.index + match[1].length;
        partIdx++;
      }
      if (lastIndex < text.length) {
        parts.push(text.slice(lastIndex));
      }
      // If marks are present, wrap the whole thing
      if (content.marks && content.marks.length > 0) {
        return content.marks.reduce((acc: any, mark: any) => {
          if (mark.type === 'bold') return <b key={keyPrefix}>{acc}</b>;
          if (mark.type === 'italic') return <i key={keyPrefix}>{acc}</i>;
          if (mark.type === 'underline') return <u key={keyPrefix}>{acc}</u>;
          if (mark.type === 'strike') return <s key={keyPrefix}>{acc}</s>;
          return acc;
        }, parts);
      }
      return parts;
    }
    // Not in client view, render as before
    if (content.marks && content.marks.length > 0) {
      return content.marks.reduce((acc: any, mark: any) => {
        if (mark.type === 'bold') return <b key={keyPrefix}>{acc}</b>;
        if (mark.type === 'italic') return <i key={keyPrefix}>{acc}</i>;
        if (mark.type === 'underline') return <u key={keyPrefix}>{acc}</u>;
        if (mark.type === 'strike') return <s key={keyPrefix}>{acc}</s>;
        return acc;
      }, text);
    }
    return text;
  }
  switch (content.type) {
    case 'paragraph':
      return <p key={keyPrefix}>{renderTiptapContent(content.content, keyPrefix + '-p', asClient, signaturePads)}</p>;
    case 'heading':
      const level = content.attrs?.level || 1;
      const headingTags = ['h1','h2','h3','h4','h5','h6'];
      const HeadingTag = headingTags[Math.max(0, Math.min(5, level-1))] || 'h1';
      return React.createElement(
        HeadingTag,
        { key: keyPrefix },
        renderTiptapContent(content.content, keyPrefix + '-h', asClient, signaturePads)
      );
    case 'bulletList':
      return <ul key={keyPrefix}>{renderTiptapContent(content.content, keyPrefix + '-ul', asClient, signaturePads)}</ul>;
    case 'orderedList':
      return <ol key={keyPrefix}>{renderTiptapContent(content.content, keyPrefix + '-ol', asClient, signaturePads)}</ol>;
    case 'listItem':
      return <li key={keyPrefix}>{renderTiptapContent(content.content, keyPrefix + '-li', asClient, signaturePads)}</li>;
    case 'blockquote':
      return <blockquote key={keyPrefix}>{renderTiptapContent(content.content, keyPrefix + '-bq', asClient, signaturePads)}</blockquote>;
    case 'horizontalRule':
      return <hr key={keyPrefix} />;
    case 'hardBreak':
      return <br key={keyPrefix} />;
    default:
      return renderTiptapContent(content.content, keyPrefix + '-d', asClient, signaturePads);
  }
};

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
  const [contactContracts, setContactContracts] = useState<{ [id: number]: { id: string; name: string } | null }>({});
  const [contractTemplates, setContractTemplates] = useState<ContractTemplate[]>([]);
  const [viewingContract, setViewingContract] = useState<{ name: string; content: any } | null>(null);

  // State for 'View as Client' mode in contract modal
  const [viewAsClient, setViewAsClient] = useState(false);
  const [signaturePads, setSignaturePads] = useState<{ [key: string]: any }>({});

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

  // Fetch contract templates when drawer opens
  useEffect(() => {
    if (drawerOpen) {
      supabase.from('contract_templates').select('id, name, content').then(({ data }) => {
        if (data) setContractTemplates(data);
      });
    }
  }, [drawerOpen]);

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
  const handleSelectContract = (template: ContractTemplate) => {
    if (drawerContactId !== null) {
      setContactContracts(prev => ({ ...prev, [drawerContactId]: { id: template.id, name: template.name } }));
      closeContractDrawer();
    }
  };

  return (
    <Fragment>
      <div className="w-full overflow-x-hidden">
        <div className="p-6">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-100 rounded-lg">
                <UserIcon className="w-6 h-6 text-purple-600" />
              </div>
              <div>
                <h3 className="text-xl font-bold">Contact Information</h3>
                <p className="text-sm text-gray-500">Manage client contacts and contracts</p>
              </div>
            </div>
            <button 
              className="btn btn-primary gap-2 shadow-sm" 
              onClick={handleCreateNewContact}
            >
              <PlusIcon className="w-4 h-4" />
              Add Contact
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 w-full pb-6">
            {contacts.map((contact, index) => {
              return (
                <div
                  key={contact.id}
                  className="bg-white border border-gray-200 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-200 overflow-hidden"
                >
                  {/* Header */}
                  <div className="px-6 py-4 bg-gray-50 border-b border-gray-100">
                    <div className="flex items-center justify-between">
                      <h4 className="text-lg font-semibold text-gray-900">
                        {contact.isMain ? 'Primary Contact' : `Contact ${index}`}
                      </h4>
                      {contact.isMain && (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                          Main
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Content */}
                  <div className="p-6">
                    <div className="space-y-5">
                      {/* Name */}
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-500 uppercase tracking-wide">Name</label>
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
                          <div className="text-base font-semibold text-gray-900">{contact.name}</div>
                        )}
                      </div>

                      {/* Mobile */}
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-500 uppercase tracking-wide">Mobile</label>
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
                          <div className="text-base text-gray-900 flex items-center gap-2">
                            <PhoneIcon className="w-4 h-4 text-gray-400" />
                            <span className="text-base font-medium">{contact.mobile}</span>
                          </div>
                        )}
                      </div>

                      {/* Phone */}
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-500 uppercase tracking-wide">Phone</label>
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
                          <a href={`tel:${contact.phone}`} className="text-base text-gray-900 hover:text-purple-600 flex items-center gap-2 transition-colors">
                            <PhoneIcon className="w-4 h-4 text-gray-400" />
                            <span className="text-base font-medium">{contact.phone}</span>
                          </a>
                        ) : (
                          <div className="text-base text-gray-900 flex items-center gap-2">
                            <PhoneIcon className="w-4 h-4 text-gray-400" />
                            <span className="text-base font-medium">{contact.phone}</span>
                          </div>
                        )}
                      </div>

                      {/* Email */}
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-500 uppercase tracking-wide">Email</label>
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
                          <a href={`mailto:${contact.email}`} className="text-base text-gray-900 hover:text-purple-600 flex items-center gap-2 transition-colors">
                            <EnvelopeIcon className="w-4 h-4 text-gray-400" />
                            <span className="text-base font-medium">{contact.email}</span>
                          </a>
                        ) : (
                          <div className="text-base text-gray-900 flex items-center gap-2">
                            <EnvelopeIcon className="w-4 h-4 text-gray-400" />
                            <span className="text-base font-medium">{contact.email}</span>
                          </div>
                        )}
                      </div>

                      {/* Contract */}
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-500 uppercase tracking-wide">Contract</label>
                        {contactContracts[contact.id] ? (
                          <div className="flex flex-col gap-2">
                            <button className="btn btn-outline btn-primary btn-sm justify-start" onClick={() => {
                              const template = contractTemplates.find(t => t.id === contactContracts[contact.id]?.id);
                              if (template) setViewingContract({ name: template.name, content: template.content });
                            }}>
                              <DocumentTextIcon className="w-4 h-4" />
                              View Contract
                            </button>
                            <button className="btn btn-ghost btn-sm justify-start" onClick={() => openContractDrawer(contact.id)}>
                              <PencilSquareIcon className="w-4 h-4" />
                              Edit Contract
                            </button>
                          </div>
                        ) : (
                          <button className="btn btn-outline btn-primary btn-sm justify-start" onClick={() => openContractDrawer(contact.id)}>
                            <PlusIcon className="w-4 h-4" />
                            Add Contract
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Footer Actions */}
                  <div className="px-6 py-4 bg-gray-50 border-t border-gray-100">
                    <div className="flex gap-2">
                      {(contact.isMain && !isEditingMainContact) || (!contact.isMain && !contact.isEditing) ? (
                        <button
                          className="btn btn-ghost btn-sm text-gray-600 hover:text-purple-600"
                          onClick={() => contact.isMain ? setIsEditingMainContact(true) : setContacts(contacts.map(c => c.id === contact.id ? { ...c, isEditing: true } : c))}
                        >
                          <PencilSquareIcon className="w-4 h-4" />
                          Edit
                        </button>
                      ) : null}
                      {((contact.isMain && isEditingMainContact) || contact.isEditing) && (
                        <>
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={() => contact.isMain ? handleSaveMainContact() : handleSaveContact(contact.id, contact)}
                          >
                            <CheckIcon className="w-4 h-4" />
                            Save
                          </button>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => contact.isMain ? handleCancelMainContact() : setContacts(contacts.map(c => c.id === contact.id ? { ...c, isEditing: false } : c))}
                          >
                            <XMarkIcon className="w-4 h-4" />
                            Cancel
                          </button>
                        </>
                      )}
                      {!contact.isMain && (
                        <button
                          className="btn btn-ghost btn-sm text-red-500 hover:text-red-600 ml-auto"
                          onClick={() => {
                            if (window.confirm('Are you sure you want to delete this contact?')) {
                              handleDeleteContact(contact.id);
                            }
                          }}
                        >
                          <TrashIcon className="w-4 h-4" />
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        
        <TimelineHistoryButtons client={client} />
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
              {contractTemplates.length === 0 ? (
                <div className="text-base-content/60">No contract templates available.</div>
              ) : contractTemplates.map(template => (
                <button
                  key={template.id}
                  className="btn btn-outline btn-lg text-left justify-start"
                  onClick={() => handleSelectContract(template)}
                >
                  {template.name}
                </button>
              ))}
            </div>
          </div>
        </>,
        document.body
      )}

      {/* Contract View Modal/Drawer */}
      {viewingContract && typeof window !== 'undefined' && createPortal(
        <>
          <div className="fixed inset-0 bg-black/30 transition-opacity duration-300 z-[9999]" onClick={() => setViewingContract(null)} />
          <div className="fixed top-0 right-0 h-screen w-full max-w-2xl bg-white shadow-2xl p-8 flex flex-col animate-slideInRight z-[10000]" style={{ minHeight: '100vh' }}>
            <button className="btn btn-ghost btn-circle absolute top-4 right-4" onClick={() => setViewingContract(null)}>
              <XMarkIcon className="w-6 h-6" />
            </button>
            <h2 className="text-2xl font-bold mb-6">{viewingContract.name}</h2>
            <div className="flex-1 overflow-y-auto bg-base-100 rounded-xl p-6 border border-base-300">
              {/* View as Client toggle */}
              <div className="flex justify-end mb-4">
                <button
                  className={`btn btn-sm ${viewAsClient ? 'btn-primary' : 'btn-outline'}`}
                  onClick={() => setViewAsClient(v => !v)}
                >
                  {viewAsClient ? 'Exit Client View' : 'View as Client'}
                </button>
              </div>
              <div className="prose max-w-full text-black">
                {renderTiptapContent(viewingContract.content?.content, '', viewAsClient, signaturePads)}
              </div>
            </div>
          </div>
        </>,
        document.body
      )}
    </Fragment>
  );
};

export default ContactInfoTab; 