import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { ExclamationTriangleIcon, CurrencyDollarIcon, CalendarIcon, DocumentTextIcon, Squares2X2Icon, Bars3Icon, PrinterIcon, EnvelopeIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { useNavigate } from 'react-router-dom';

const COLLECTION_LABEL_OPTIONS = [
  { value: 'Important' },
  { value: 'Follow up' },
  { value: 'No answer' },
  { value: 'Due' },
  { value: 'Overdue' },
];

const CollectionPage: React.FC = () => {
  const [leads, setLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'no_payment' | 'awaiting' | 'paid'>('no_payment');
  const [viewMode, setViewMode] = useState<'list' | 'cards'>('cards');
  const navigate = useNavigate();

  // --- Summary values (mock logic for now) ---
  const [totalPaid, setTotalPaid] = useState(0);
  const [dueSoon, setDueSoon] = useState(0);
  const [overdue, setOverdue] = useState(0);
  const [showPaidChart, setShowPaidChart] = useState(false);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [labelInput, setLabelInput] = useState('');
  const [commentInput, setCommentInput] = useState('');
  const [showContractModal, setShowContractModal] = useState(false);
  const [showProformaModal, setShowProformaModal] = useState(false);
  const [selectedProforma, setSelectedProforma] = useState<any>(null);

  // Add state for mock data arrays for all tabs
  const [awaitingPayments, setAwaitingPayments] = useState<any[]>([]);

  const [paidMeetings, setPaidMeetings] = useState<any[]>([
    {
      id: 1,
      lead_number: 'L20001',
      name: 'Noah Cohen',
      date: '2024-07-03',
      total: 600,
      details: 'Paid in full',
    },
    {
      id: 2,
      lead_number: 'L20002',
      name: 'Olivia Levi',
      date: '2024-07-04',
      total: 200,
      details: 'Paid in full',
    },
    {
      id: 3,
      lead_number: 'L20003',
      name: 'Liam Katz',
      date: '2024-07-05',
      total: 1200,
      details: 'Paid in full',
    },
    {
      id: 4,
      lead_number: 'L20004',
      name: 'Maya Gold',
      date: '2024-07-06',
      total: 950,
      details: 'Paid in full',
    },
  ]);

  // Mock data for paid by month (last 5 months)
  const paidByMonth = [
    { month: 'March', total: 7000 },
    { month: 'April', total: 9500 },
    { month: 'May', total: 8000 },
    { month: 'June', total: 12000 },
    { month: 'July', total: 15000 },
  ];

  // Helper for currency symbol (copied from Clients.tsx)
  const getCurrencySymbol = (currencyCode?: string) => {
    switch (currencyCode) {
      case 'USD':
        return '$';
      case 'EUR':
        return '€';
      case 'NIS':
        return '₪';
      default:
        return '₪';
    }
  };

  // Mock proforma data
  const mockProformaData = {
    number: 'PR-2024-001',
    date: '2024-07-01',
    dueDate: '2024-07-15',
    createdAt: '2024-07-01T10:30:00Z',
    createdBy: 'Sarah Cohen',
    client: {
      name: 'David Lee',
      address: '123 Business Street, Tel Aviv, Israel',
      phone: '+972-50-123-4567',
      email: 'david.lee@example.com'
    },
    company: {
      name: 'Decker Pex Levi Lawoffices',
      address: 'WE Tower TLV, 150 Begin Rd., Tel Aviv, Israel',
      phone: '+972-3-123-4567',
      email: 'info@lawoffices.org.il',
      vatNumber: 'IL123456789',
      companyNumber: '12345678'
    },
    items: [
      {
        description: 'German Citizenship Application Services',
        quantity: 1,
        unitPrice: 10000,
        vatRate: 17,
        amount: 10000
      },
      {
        description: 'Document Preparation & Translation',
        quantity: 1,
        unitPrice: 2000,
        vatRate: 17,
        amount: 2000
      }
    ]
  };

  const calculateTotals = (items: any[]) => {
    const subtotal = items.reduce((sum, item) => sum + item.amount, 0);
    const vat = items.reduce((sum, item) => sum + (item.amount * item.vatRate / 100), 0);
    const total = subtotal + vat;
    return { subtotal, vat, total };
  };

  const handleProformaClick = (proformaNumber: string) => {
    setSelectedProforma({ 
      ...mockProformaData, 
      number: proformaNumber,
      createdAt: new Date().toISOString(),
      createdBy: 'Current User' // In real app, get from auth context
    });
    setShowProformaModal(true);
  };

  const handlePrintProforma = () => {
    window.print();
  };

  const handleSendToClient = () => {
    // Mock functionality - in real app, this would send email
    alert(`Proforma ${selectedProforma?.number} sent to ${selectedProforma?.client.email}`);
  };

  // 1. Add state for collection comments and label
  const [collectionLabelInput, setCollectionLabelInput] = useState('');
  const [collectionComments, setCollectionComments] = useState<any[]>([]);
  const [newCollectionComment, setNewCollectionComment] = useState('');
  const [savingCollection, setSavingCollection] = useState(false);

  // Add state for current user
  const [currentUserName, setCurrentUserName] = useState<string>('');

  useEffect(() => {
    if (tab === 'no_payment') {
      const fetchLeads = async () => {
        setLoading(true);
        const { data, error } = await supabase
          .from('leads')
          .select('id, lead_number, name, date_signed, balance, stage, collection_label, collection_comments')
          .in('stage', ['Client Signed Agreement', 'Client signed agreement']);
        if (!error && data) {
          setLeads(data);
        } else {
          setLeads([]);
        }
        setLoading(false);
      };
      fetchLeads();
    }

    // Mock logic: Replace with real queries as needed
    // Total Paid (this month): sum of paidMeetings in current month
    const now = new Date();
    const thisMonth = now.getMonth();
    const thisYear = now.getFullYear();
    const paidThisMonth = paidMeetings.filter(m => {
      const d = new Date(m.date);
      return d.getMonth() === thisMonth && d.getFullYear() === thisYear;
    });
    setTotalPaid(paidThisMonth.reduce((sum, m) => sum + (m.total || 0), 0));

    // Due Soon: count of awaitingPayments (mock: all in array)
    setDueSoon(awaitingPayments.length);

    // Overdue: count of leads with next_followup in the past (mock: 1)
    setOverdue(1);

    // Fetch current user info on mount
    const fetchUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user && user.email) {
        // Try to get full_name from users table
        const { data, error } = await supabase
          .from('users')
          .select('full_name')
          .eq('email', user.email)
          .single();
        if (!error && data?.full_name) {
          setCurrentUserName(data.full_name);
        } else {
          setCurrentUserName(user.email);
        }
      }
    };
    fetchUser();
  }, [tab, paidMeetings, awaitingPayments]);

  useEffect(() => {
    const fetchAwaitingPayments = async () => {
      setLoading(true);
      // Fetch all payment_plans with a proforma, join to leads for lead_number and name
      const { data, error } = await supabase
        .from('payment_plans')
        .select('id, lead_id, due_date, value, value_vat, proforma, payment_order, leads:lead_id(lead_number, name)')
        .not('proforma', 'is', null)
        .order('due_date', { ascending: true });
      if (error) {
        setAwaitingPayments([]);
        setLoading(false);
        return;
      }
      // Map to display format
      const mapped = (data || []).map((row: any) => {
        let proformaName = 'Proforma';
        if (row.proforma) {
          try {
            const parsed = JSON.parse(row.proforma);
            proformaName = parsed.proformaName || 'Proforma';
          } catch {}
        }
        return {
          id: row.id,
          lead_number: row.leads?.lead_number || '',
          name: row.leads?.name || '',
          date: row.due_date,
          total_amount: Number(row.value) + Number(row.value_vat),
          proformaName,
          order: row.payment_order || '',
        };
      });
      setAwaitingPayments(mapped);
      setLoading(false);
    };
    fetchAwaitingPayments();
  }, []);

  // Helper to open drawer for a lead/meeting
  const handleOpenDrawer = (item: any) => {
    setSelectedItem(item);
    setCollectionLabelInput(item.collection_label || '');
    setCollectionComments(item.collection_comments || []);
    setNewCollectionComment('');
    setDrawerOpen(true);
  };
  const handleCloseDrawer = () => {
    setDrawerOpen(false);
    setSelectedItem(null);
    setLabelInput('');
    setCommentInput('');
  };
  const handleSaveDrawer = () => {
    // For mock: update label/comment in the correct array
    if (!selectedItem) return;
    const updateArray = (arr: any[]) => arr.map(l => l.id === selectedItem.id ? { ...l, label: labelInput, comment: commentInput } : l);
    if (tab === 'no_payment') setLeads(updateArray(leads));
    if (tab === 'awaiting') setAwaitingPayments(updateArray(awaitingPayments));
    if (tab === 'paid') setPaidMeetings(updateArray(paidMeetings));
    handleCloseDrawer();
  };

  // 4. Add handler to save label
  const handleSaveCollectionLabel = async () => {
    if (!selectedItem) return;
    setSavingCollection(true);
    await supabase.from('leads').update({ collection_label: collectionLabelInput }).eq('id', selectedItem.id);
    setLeads(leads => leads.map(l => l.id === selectedItem.id ? { ...l, collection_label: collectionLabelInput } : l));
    setSavingCollection(false);
  };
  // 5. Add handler to add a comment
  const handleAddCollectionComment = async () => {
    if (!selectedItem || !newCollectionComment.trim()) return;
    setSavingCollection(true);
    const commentObj = { text: newCollectionComment.trim(), timestamp: new Date().toISOString(), user: currentUserName || 'User' };
    const updatedComments = [...collectionComments, commentObj];
    await supabase.from('leads').update({ collection_comments: updatedComments }).eq('id', selectedItem.id);
    setCollectionComments(updatedComments);
    setLeads(leads => leads.map(l => l.id === selectedItem.id ? { ...l, collection_comments: updatedComments } : l));
    setNewCollectionComment('');
    setSavingCollection(false);
  };

  return (
    <div className="p-4 md:p-6 lg:p-8 w-full">
      {/* Summary Boxes */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8 w-full">
        {/* Total Paid (this month) */}
        <div
          className="rounded-2xl transition-all duration-300 shadow-xl bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white relative overflow-hidden cursor-pointer"
          onClick={() => setShowPaidChart((v) => !v)}
        >
          <div className="flex items-center gap-4 p-6">
            <div className="flex items-center justify-center w-14 h-14 rounded-full bg-white/20 shadow">
              <CurrencyDollarIcon className="w-7 h-7 text-white opacity-90" />
            </div>
            <div>
              <div className="text-4xl font-extrabold text-white leading-tight">₪{totalPaid.toLocaleString()}</div>
              <div className="text-white/80 text-sm font-medium mt-1">Total Paid (This Month)</div>
            </div>
          </div>
          <svg className="absolute bottom-4 right-4 w-16 h-8 opacity-40" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 64 32"><path d="M2 28 Q16 8 32 20 T62 8" /></svg>
        </div>
        {/* Due Soon */}
        <div className="rounded-2xl transition-all duration-300 shadow-xl bg-gradient-to-tr from-teal-400 via-green-400 to-green-600 text-white relative overflow-hidden">
          <div className="flex items-center gap-4 p-6">
            <div className="flex items-center justify-center w-14 h-14 rounded-full bg-white/20 shadow">
              <CalendarIcon className="w-7 h-7 text-white opacity-90" />
            </div>
            <div>
              <div className="text-4xl font-extrabold text-white leading-tight">{dueSoon}</div>
              <div className="text-white/80 text-sm font-medium mt-1">Due Soon</div>
            </div>
          </div>
          <svg className="absolute bottom-4 right-4 w-16 h-8 opacity-40" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 64 32"><polyline points="2,28 16,20 32,24 48,10 62,18" /></svg>
        </div>
        {/* Overdue */}
        <div className="rounded-2xl transition-all duration-300 shadow-xl bg-gradient-to-tr from-purple-600 via-blue-600 to-blue-500 text-white relative overflow-hidden">
          <div className="flex items-center gap-4 p-6">
            <div className="flex items-center justify-center w-14 h-14 rounded-full bg-white/20 shadow">
              <ExclamationTriangleIcon className="w-7 h-7 text-white opacity-90" />
            </div>
            <div>
              <div className="text-4xl font-extrabold text-white leading-tight">{overdue}</div>
              <div className="text-white/80 text-sm font-medium mt-1">Overdue</div>
            </div>
          </div>
          <svg className="absolute bottom-4 right-4 w-12 h-8 opacity-40" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 48 32"><rect x="2" y="20" width="4" height="10"/><rect x="10" y="10" width="4" height="20"/><rect x="18" y="16" width="4" height="14"/><rect x="26" y="6" width="4" height="24"/><rect x="34" y="14" width="4" height="16"/></svg>
        </div>
      </div>
      {/* Paid by Month Curve Chart */}
      {showPaidChart && (
        <div className="w-full bg-white rounded-2xl shadow-lg p-8 mb-8 flex flex-col items-center animate-fade-in">
          <h2 className="text-xl font-bold mb-4 text-primary">Total Paid by Month (Last 5 Months)</h2>
          <div className="w-full" style={{ minHeight: 280, height: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={paidByMonth} margin={{ top: 24, right: 32, left: 8, bottom: 24 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#edeafd" />
                <XAxis dataKey="month" tick={{ fontSize: 16, fill: '#3b28c7', fontWeight: 600 }} axisLine={{ stroke: '#a21caf' }} tickLine={false} />
                <YAxis tick={{ fontSize: 14, fill: '#3b28c7' }} axisLine={{ stroke: '#a21caf' }} tickLine={false} width={60} />
                <Tooltip formatter={(value: number) => `₪${value.toLocaleString()}`} />
                <Line type="monotone" dataKey="total" name="Total Paid" stroke="#a21caf" strokeWidth={4} dot={{ r: 7, fill: '#fff', stroke: '#a21caf', strokeWidth: 3 }} activeDot={{ r: 10, fill: '#a21caf', stroke: '#3b28c7', strokeWidth: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
      <div className="flex gap-4 mb-10 mt-2">
        <button
          className={`px-7 py-3 rounded-full text-lg font-bold transition-all duration-200 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40
            ${tab === 'no_payment' ? 'bg-primary text-white' : 'bg-white text-primary hover:bg-primary/10 hover:text-primary'}`}
          onClick={() => setTab('no_payment')}
          aria-current={tab === 'no_payment' ? 'page' : undefined}
        >
          No Payment Plan
        </button>
        <button
          className={`px-7 py-3 rounded-full text-lg font-bold transition-all duration-200 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40
            ${tab === 'awaiting' ? 'bg-primary text-white' : 'bg-white text-primary hover:bg-primary/10 hover:text-primary'}`}
          onClick={() => setTab('awaiting')}
          aria-current={tab === 'awaiting' ? 'page' : undefined}
        >
          Awaiting Payment
        </button>
        <button
          className={`px-7 py-3 rounded-full text-lg font-bold transition-all duration-200 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40
            ${tab === 'paid' ? 'bg-primary text-white' : 'bg-white text-primary hover:bg-primary/10 hover:text-primary'}`}
          onClick={() => setTab('paid')}
          aria-current={tab === 'paid' ? 'page' : undefined}
        >
          Paid Meetings
        </button>
      </div>
      {/* View Mode Toggle */}
      <div className="flex justify-end mb-4">
        <button
          className="btn btn-outline btn-primary btn-sm flex items-center gap-2"
          onClick={() => setViewMode(viewMode === 'cards' ? 'list' : 'cards')}
          title={viewMode === 'cards' ? 'Switch to List View' : 'Switch to Card View'}
        >
          {viewMode === 'cards' ? (
            <Bars3Icon className="w-5 h-5" />
          ) : (
            <Squares2X2Icon className="w-5 h-5" />
          )}
          <span className="hidden md:inline">{viewMode === 'cards' ? 'List View' : 'Card View'}</span>
        </button>
      </div>
      {tab === 'no_payment' && (
        loading ? (
          <div className="flex justify-center items-center h-40">
            <span className="loading loading-spinner loading-lg text-primary"></span>
          </div>
        ) : leads.length === 0 ? (
          <div className="text-center text-gray-500 mt-12">No leads found where the client has signed the contract.</div>
        ) : viewMode === 'list' ? (
          <div className="overflow-x-auto bg-white rounded-2xl shadow-lg p-6 w-full">
            <table className="table w-full">
              <thead>
                <tr>
                  <th className="text-lg font-bold">&nbsp;</th>
                  <th className="text-lg font-bold">Lead</th>
                  <th className="text-lg font-bold">Client Name</th>
                  <th className="text-lg font-bold">Date Signed</th>
                  <th className="text-lg font-bold">Total Amount</th>
                  <th className="text-lg font-bold">Label</th>
                  <th className="text-lg font-bold">Comments</th>
                </tr>
              </thead>
              <tbody className="text-base">
                {leads.map((lead) => (
                  <tr key={lead.id}>
                    <td><span className="flex items-center gap-1 px-3 py-1 rounded-full font-bold bg-gradient-to-tr from-green-500 via-emerald-500 to-teal-400 text-white shadow">NEW!</span></td>
                    <td className="font-bold text-primary">{lead.lead_number}</td>
                    <td>{lead.name}</td>
                    <td>{lead.date_signed ? new Date(lead.date_signed).toLocaleDateString() : '-'}</td>
                    <td>{lead.balance ? `₪${lead.balance.toLocaleString()}` : '-'}</td>
                    <td>{lead.collection_label || '-'}</td>
                    <td>{Array.isArray(lead.collection_comments) && lead.collection_comments.length > 0 ? lead.collection_comments[lead.collection_comments.length - 1].text : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-6">
            {leads.map((lead) => (
              <div 
                key={lead.id} 
                className="bg-white rounded-2xl p-5 shadow-md hover:shadow-xl transition-all duration-200 transform hover:-translate-y-1 border border-gray-100 group flex flex-col justify-between h-full min-h-[300px] relative pb-8 cursor-pointer"
                onClick={() => handleOpenDrawer(lead)}
              >
                {lead.collection_label && (
                  <div className="flex justify-end">
                    <span className="mt-[-18px] mb-2 px-3 py-1 rounded-full font-bold text-xs shadow bg-white border-2 border-[#3b28c7] text-[#3b28c7]">
                      {lead.collection_label}
                    </span>
                  </div>
                )}
                <div className="flex-1 flex flex-col">
                  {/* Lead Number and Name */}
                  <div className="mb-3 flex items-center gap-2">
                    <span className="flex items-center gap-1 px-3 py-1 rounded-full font-bold bg-gradient-to-tr from-green-500 via-emerald-500 to-teal-400 text-white shadow">NEW!</span>
                    <span className="text-xs font-semibold text-gray-400 tracking-widest">{lead.lead_number}</span>
                    <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
                    <span className="text-lg font-extrabold text-gray-900 group-hover:text-primary transition-colors truncate flex-1">{lead.name}</span>
                  </div>
                  {/* Stage */}
                  <div className="flex justify-between items-center py-1">
                    <span className="text-xs font-semibold text-gray-500">Stage</span>
                    <span className="text-xs font-bold ml-2 px-2 py-1 rounded bg-[#3b28c7] text-white">
                      {lead.stage ? lead.stage.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()) : 'N/A'}
                    </span>
                  </div>
                  <div className="space-y-2 divide-y divide-gray-100">
                    {/* Date Signed */}
                    <div className="flex justify-between items-center py-1">
                      <span className="text-xs font-semibold text-gray-500">Date Signed</span>
                      <span className="text-sm font-bold text-gray-800 ml-2">{lead.date_signed ? new Date(lead.date_signed).toLocaleDateString() : '-'}</span>
                    </div>
                    {/* Total Amount */}
                    <div className="flex justify-between items-center py-1">
                      <span className="text-xs font-semibold text-gray-500">Total Amount</span>
                      <span className="text-sm font-bold text-gray-800 ml-2">
                        {lead.balance !== undefined && lead.balance !== null
                          ? `${getCurrencySymbol(lead.balance_currency)}${lead.balance.toLocaleString()}`
                          : 'N/A'}
                      </span>
                    </div>
                    {/* Details */}
                    <div className="flex justify-between items-center py-1">
                      <span className="text-xs font-semibold text-gray-500">Details</span>
                      <span className="flex items-center gap-2 text-sm font-bold text-gray-800 ml-2">
                        Client signed contract <ExclamationTriangleIcon className="w-5 h-5 text-primary" />
                      </span>
                    </div>
                  </div>
                </div>
                {lead.collection_comments && lead.collection_comments.length > 0 && (
                  <div className="absolute left-5 bottom-5 max-w-[85%] flex items-end">
                    <div className="flex items-start gap-2">
                      <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary flex items-center justify-center shadow text-white text-sm font-bold">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4-4.03 7-9 7a9.77 9.77 0 01-4-.8l-4.28 1.07a1 1 0 01-1.21-1.21l1.07-4.28A7.94 7.94 0 013 12c0-4 4.03-7 9-7s9 3 9 7z"/></svg>
                      </div>
                      <div className="relative bg-white border border-base-200 rounded-2xl px-4 py-2 shadow-md text-sm text-base-content/90" style={{minWidth: '120px'}}>
                        <div className="font-medium leading-snug max-w-xs truncate" title={lead.collection_comments[lead.collection_comments.length - 1].text}>{lead.collection_comments[lead.collection_comments.length - 1].text}</div>
                        <div className="text-[11px] text-base-content/50 text-right mt-1">
                          {lead.collection_comments[lead.collection_comments.length - 1].user} · {new Date(lead.collection_comments[lead.collection_comments.length - 1].timestamp).toLocaleString()}
                        </div>
                        <div className="absolute left-[-10px] bottom-2 w-0 h-0 border-t-8 border-t-transparent border-b-8 border-b-transparent border-r-8 border-r-white border-l-0"></div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      )}
      {/* Awaiting Payment Tab */}
      {tab === 'awaiting' && (
        <>
          {loading ? (
            <div className="text-center text-gray-500 mt-12">Loading...</div>
          ) : awaitingPayments.length === 0 ? (
            <div className="text-center text-gray-500 mt-12">No payments awaiting.</div>
          ) : viewMode === 'list' ? (
            <div className="overflow-x-auto bg-white rounded-2xl shadow-lg p-6 w-full">
              <table className="table w-full">
                <thead>
                  <tr>
                    <th className="text-lg font-bold">&nbsp;</th>
                    <th className="text-lg font-bold">Lead</th>
                    <th className="text-lg font-bold">Client Name</th>
                    <th className="text-lg font-bold">Date</th>
                    <th className="text-lg font-bold">Total Amount</th>
                    <th className="text-lg font-bold">Order</th>
                    <th className="text-lg font-bold">Proforma</th>
                  </tr>
                </thead>
                <tbody className="text-base">
                  {awaitingPayments.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <span className="flex items-center gap-1 px-3 py-1 rounded-full font-bold bg-gradient-to-tr from-purple-500 via-primary to-pink-400 text-white shadow">
                          <ExclamationTriangleIcon className="w-4 h-4 text-white" /> Due
                        </span>
                      </td>
                      <td className="font-bold text-primary">{row.lead_number}</td>
                      <td>{row.name}</td>
                      <td>{row.date ? new Date(row.date).toLocaleDateString() : '-'}</td>
                      <td>{row.total_amount ? `₪${row.total_amount.toLocaleString()}` : '-'}</td>
                      <td>{row.order || '-'}</td>
                      <td>
                        <button
                          className="btn btn-sm btn-outline btn-primary"
                          onClick={() => navigate(`/proforma/${row.id}`)}
                        >
                          {row.proformaName}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full">
              {awaitingPayments.map((row) => (
                <div 
                  key={row.id} 
                  className="bg-white rounded-2xl p-5 shadow-md hover:shadow-xl transition-all duration-200 transform hover:-translate-y-1 border border-gray-100 group flex flex-col justify-between h-full min-h-[300px] relative pb-8 cursor-pointer"
                  onClick={() => handleOpenDrawer(row)}
                >
                  <div className="flex-1 flex flex-col">
                    {/* Lead Number and Name */}
                    <div className="mb-3 flex items-center gap-2">
                      <span className="flex items-center gap-1 px-3 py-1 rounded-full font-bold bg-gradient-to-tr from-purple-500 via-primary to-pink-400 text-white shadow">
                        <ExclamationTriangleIcon className="w-4 h-4 text-white" /> Due
                      </span>
                      <span className="text-xs font-semibold text-gray-400 tracking-widest">{row.lead_number}</span>
                      <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
                      <span className="text-lg font-extrabold text-gray-900 group-hover:text-primary transition-colors truncate flex-1">{row.name}</span>
                    </div>
                    <div className="space-y-2 divide-y divide-gray-100">
                      {/* Date */}
                      <div className="flex justify-between items-center py-1">
                        <span className="text-xs font-semibold text-gray-500">Date</span>
                        <span className="text-sm font-bold text-gray-800 ml-2">{row.date ? new Date(row.date).toLocaleDateString() : '-'}</span>
                      </div>
                      {/* Total Amount */}
                      <div className="flex justify-between items-center py-1">
                        <span className="text-xs font-semibold text-gray-500">Total Amount</span>
                        <span className="text-sm font-bold text-gray-800 ml-2">
                          {row.total_amount ? `₪${row.total_amount.toLocaleString()}` : 'N/A'}
                        </span>
                      </div>
                      {/* Order */}
                      <div className="flex justify-between items-center py-1">
                        <span className="text-xs font-semibold text-gray-500">Order</span>
                        <span className="text-sm font-bold text-gray-800 ml-2">{row.order || '-'}</span>
                      </div>
                      {/* Proforma */}
                      <div className="flex justify-between items-center py-1">
                        <span className="text-xs font-semibold text-gray-500">Proforma</span>
                        <button 
                          className="text-sm font-bold text-blue-600 hover:text-blue-800 cursor-pointer underline ml-2"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/proforma/${row.id}`);
                          }}
                        >
                          {row.proformaName}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {tab === 'paid' && (
        paidMeetings.length === 0 ? (
          <div className="text-center text-gray-500 mt-12">No paid meetings found.</div>
        ) : viewMode === 'list' ? (
          <div className="overflow-x-auto bg-white rounded-2xl shadow-lg p-6 w-full">
            <table className="table w-full">
              <thead>
                <tr>
                  <th className="text-lg font-bold">&nbsp;</th>
                  <th className="text-lg font-bold">Lead</th>
                  <th className="text-lg font-bold">Client Name</th>
                  <th className="text-lg font-bold">Date</th>
                  <th className="text-lg font-bold">Total</th>
                  <th className="text-lg font-bold">Details</th>
                </tr>
              </thead>
              <tbody className="text-base">
                {paidMeetings.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <span className="flex items-center gap-2">
                        <CurrencyDollarIcon className="w-5 h-5 text-green-600" />
                        <CalendarIcon className="w-5 h-5 text-blue-500" />
                      </span>
                    </td>
                    <td className="font-bold text-primary">{row.lead_number}</td>
                    <td>{row.name}</td>
                    <td>{row.date ? new Date(row.date).toLocaleDateString() : '-'}</td>
                    <td>{row.total ? `₪${row.total.toLocaleString()}` : '-'}</td>
                    <td>{row.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full">
            {paidMeetings.map((row) => (
              <div 
                key={row.id} 
                className="bg-white rounded-2xl p-5 shadow-md hover:shadow-xl transition-all duration-200 transform hover:-translate-y-1 border border-gray-100 group flex flex-col justify-between h-full min-h-[300px] relative pb-8 cursor-pointer"
                onClick={() => handleOpenDrawer(row)}
              >
                {row.collection_label && (
                  <div className="flex justify-end">
                    <span className="mt-[-18px] mb-2 px-3 py-1 rounded-full font-bold text-xs shadow bg-white border-2 border-[#3b28c7] text-[#3b28c7]">
                      {row.collection_label}
                    </span>
                  </div>
                )}
                <div className="flex-1 flex flex-col">
                  {/* Lead Number and Name */}
                  <div className="mb-3 flex items-center gap-2">
                    <span className="flex items-center gap-2">
                      <CurrencyDollarIcon className="w-5 h-5 text-green-600" />
                      <CalendarIcon className="w-5 h-5 text-blue-500" />
                    </span>
                    <span className="text-xs font-semibold text-gray-400 tracking-widest">{row.lead_number}</span>
                    <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
                    <span className="text-lg font-extrabold text-gray-900 group-hover:text-primary transition-colors truncate flex-1">{row.name}</span>
                  </div>
                  <div className="space-y-2 divide-y divide-gray-100">
                    {/* Date */}
                    <div className="flex justify-between items-center py-1">
                      <span className="text-xs font-semibold text-gray-500">Date</span>
                      <span className="text-sm font-bold text-gray-800 ml-2">{row.date ? new Date(row.date).toLocaleDateString() : '-'}</span>
                    </div>
                    {/* Total */}
                    <div className="flex justify-between items-center py-1">
                      <span className="text-xs font-semibold text-gray-500">Total</span>
                      <span className="text-sm font-bold text-gray-800 ml-2">
                        {row.total ? `${getCurrencySymbol()}${row.total.toLocaleString()}` : 'N/A'}
                      </span>
                    </div>
                    {/* Details */}
                    <div className="flex justify-between items-center py-1">
                      <span className="text-xs font-semibold text-gray-500">Details</span>
                      <span className="text-sm font-bold text-gray-800 ml-2">{row.details}</span>
                    </div>
                  </div>
                </div>
                {row.collection_comments && row.collection_comments.length > 0 && (
                  <div className="absolute left-5 bottom-5 max-w-[85%] flex items-end">
                    <div className="flex items-start gap-2">
                      <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary flex items-center justify-center shadow text-white text-sm font-bold">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4-4.03 7-9 7a9.77 9.77 0 01-4-.8l-4.28 1.07a1 1 0 01-1.21-1.21l1.07-4.28A7.94 7.94 0 013 12c0-4 4.03-7 9-7s9 3 9 7z"/></svg>
                      </div>
                      <div className="relative bg-white border border-base-200 rounded-2xl px-4 py-2 shadow-md text-sm text-base-content/90" style={{minWidth: '120px'}}>
                        <div className="font-medium leading-snug max-w-xs truncate" title={row.collection_comments[row.collection_comments.length - 1].text}>{row.collection_comments[row.collection_comments.length - 1].text}</div>
                        <div className="text-[11px] text-base-content/50 text-right mt-1">
                          {row.collection_comments[row.collection_comments.length - 1].user} · {new Date(row.collection_comments[row.collection_comments.length - 1].timestamp).toLocaleString()}
                        </div>
                        <div className="absolute left-[-10px] bottom-2 w-0 h-0 border-t-8 border-t-transparent border-b-8 border-b-transparent border-r-8 border-r-white border-l-0"></div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      )}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div className="fixed inset-0 bg-black/30" onClick={handleCloseDrawer}></div>
          <div className="relative bg-white w-full max-w-md ml-auto h-full shadow-2xl p-8 flex flex-col">
            <h2 className="text-2xl font-bold mb-4">Collection Label & Comments</h2>
            <label className="font-semibold mb-1">Label</label>
            <div className="flex gap-2 mb-4">
              <select
                className="select select-bordered w-full"
                value={collectionLabelInput}
                onChange={e => setCollectionLabelInput(e.target.value)}
                disabled={savingCollection}
              >
                <option value="">Choose label...</option>
                {COLLECTION_LABEL_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.value}</option>
                ))}
              </select>
              <button className="btn btn-primary" onClick={handleSaveCollectionLabel} disabled={savingCollection}>Save</button>
            </div>
            <label className="font-semibold mb-1">Comments</label>
            <div className="mb-2 max-h-40 overflow-y-auto space-y-2">
              {collectionComments.length === 0 ? (
                <div className="text-base-content/40">No comments yet.</div>
              ) : (
                collectionComments.slice().reverse().map((c, idx) => (
                  <div key={idx} className="bg-base-200 rounded-lg p-3 flex flex-col">
                    <span className="text-base-content/90">{c.text}</span>
                    <span className="text-xs text-base-content/50 mt-1">{c.user} · {new Date(c.timestamp).toLocaleString()}</span>
                  </div>
                ))
              )}
            </div>
            <div className="flex gap-2 mt-2">
              <input
                className="input input-bordered flex-1"
                placeholder="Add a comment..."
                value={newCollectionComment}
                onChange={e => setNewCollectionComment(e.target.value)}
                disabled={savingCollection}
              />
              <button className="btn btn-primary" onClick={handleAddCollectionComment} disabled={savingCollection || !newCollectionComment.trim()}>Add</button>
            </div>
            <button
              className="btn btn-primary mb-4 mt-6"
              onClick={() => setShowContractModal(true)}
            >
              View Contract
            </button>
            <div className="flex gap-2 mt-auto">
              <button className="btn btn-outline flex-1" onClick={handleCloseDrawer}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      {showContractModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/40" onClick={() => setShowContractModal(false)}></div>
          <div className="relative bg-white rounded-xl shadow-2xl p-8 max-w-lg w-full">
            <h3 className="text-xl font-bold mb-4">Contract Details</h3>
            <div className="prose max-w-none mb-6">
              {/* Replace with real contract content or PDF preview */}
              <p>This is a mock contract preview for lead/meeting <b>{selectedItem?.lead_number || selectedItem?.name}</b>.</p>
              <p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer nec odio. Praesent libero. Sed cursus ante dapibus diam.</p>
            </div>
            <button className="btn btn-primary w-full" onClick={() => setShowContractModal(false)}>Close</button>
          </div>
        </div>
      )}
      {/* Proforma Modal */}
      {showProformaModal && selectedProforma && (
        <div className="fixed inset-0 z-60 bg-black/30 flex items-center justify-center p-4">
          <div id="proforma-print-area" className="bg-white rounded-xl shadow-2xl max-w-4xl w-full h-full flex flex-col overflow-hidden mt-24">
            {/* Header */}
            <div className="flex justify-between items-center p-6 border-b border-gray-200 bg-gray-50 sticky top-0 z-10">
              <div className="flex items-center gap-4">
                <h2 className="text-2xl font-bold text-gray-900">PROFORMA INVOICE</h2>
                <div className="text-sm text-gray-600">
                  <div>Created: <span className="font-semibold">{new Date(selectedProforma.createdAt).toLocaleString()}</span></div>
                  <div>By: <span className="font-semibold">{selectedProforma.createdBy}</span></div>
                </div>
              </div>
              <div className="flex items-center gap-2 proforma-action-buttons">
                <button 
                  className="btn btn-outline btn-sm gap-2"
                  onClick={handlePrintProforma}
                  title="Print Proforma"
                >
                  <PrinterIcon className="w-4 h-4" />
                  Print
                </button>
                <button 
                  className="btn btn-primary btn-sm gap-2"
                  onClick={handleSendToClient}
                  title="Send to Client"
                >
                  <EnvelopeIcon className="w-4 h-4" />
                  Send to Client
                </button>
                <button 
                  className="btn btn-circle btn-ghost btn-sm"
                  onClick={() => setShowProformaModal(false)}
                  title="Close"
                >
                  <XMarkIcon className="w-5 h-5" />
                </button>
              </div>
            </div>
            
            {/* Content */}
            <div className="flex-1 overflow-y-auto p-8">
              {/* Header */}
              <div className="flex justify-between items-start mb-8 max-w-6xl mx-auto">
                <div>
                  <div className="text-sm text-gray-600">
                    <div>Proforma No: <span className="font-semibold">{selectedProforma.number}</span></div>
                    <div>Date: <span className="font-semibold">{new Date(selectedProforma.date).toLocaleDateString()}</span></div>
                    <div>Due Date: <span className="font-semibold">{new Date(selectedProforma.dueDate).toLocaleDateString()}</span></div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-gray-900 mb-2">{selectedProforma.company.name}</div>
                  <div className="text-sm text-gray-600">
                    <div>{selectedProforma.company.address}</div>
                    <div>Phone: {selectedProforma.company.phone}</div>
                    <div>Email: {selectedProforma.company.email}</div>
                    <div>VAT: {selectedProforma.company.vatNumber}</div>
                    <div>Company No: {selectedProforma.company.companyNumber}</div>
                  </div>
                </div>
              </div>

              {/* Client Info */}
              <div className="mb-8 p-4 bg-gray-50 rounded-lg max-w-6xl mx-auto">
                <h3 className="font-semibold text-gray-900 mb-2">Bill To:</h3>
                <div className="text-sm text-gray-700">
                  <div className="font-semibold">{selectedProforma.client.name}</div>
                  <div>{selectedProforma.client.address}</div>
                  <div>Phone: {selectedProforma.client.phone}</div>
                  <div>Email: {selectedProforma.client.email}</div>
                </div>
              </div>

              {/* Items Table */}
              <div className="mb-8 max-w-6xl mx-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-gray-100">
                      <th className="text-left p-3 border border-gray-300 font-semibold">Description</th>
                      <th className="text-center p-3 border border-gray-300 font-semibold">Qty</th>
                      <th className="text-right p-3 border border-gray-300 font-semibold">Unit Price</th>
                      <th className="text-center p-3 border border-gray-300 font-semibold">VAT %</th>
                      <th className="text-right p-3 border border-gray-300 font-semibold">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedProforma.items.map((item: any, index: number) => (
                      <tr key={index} className="border-b border-gray-200">
                        <td className="p-3 border border-gray-300">{item.description}</td>
                        <td className="p-3 border border-gray-300 text-center">{item.quantity}</td>
                        <td className="p-3 border border-gray-300 text-right">{getCurrencySymbol()} {item.unitPrice.toLocaleString()}</td>
                        <td className="p-3 border border-gray-300 text-center">{item.vatRate}%</td>
                        <td className="p-3 border border-gray-300 text-right font-semibold">{getCurrencySymbol()} {item.amount.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Totals */}
              <div className="flex justify-end mb-8 max-w-6xl mx-auto">
                <div className="w-80">
                  {(() => {
                    const totals = calculateTotals(selectedProforma.items);
                    return (
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span>Subtotal:</span>
                          <span>{getCurrencySymbol()} {totals.subtotal.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span>VAT (17%):</span>
                          <span>{getCurrencySymbol()} {totals.vat.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between text-lg font-bold border-t pt-2">
                          <span>Total:</span>
                          <span>{getCurrencySymbol()} {totals.total.toLocaleString()}</span>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* Terms */}
              <div className="mb-8 p-4 bg-gray-50 rounded-lg max-w-6xl mx-auto">
                <h3 className="font-semibold text-gray-900 mb-2">Terms & Conditions:</h3>
                <div className="text-sm text-gray-700 space-y-1">
                  <div>• Payment is due within 14 days of invoice date</div>
                  <div>• Late payments may incur additional charges</div>
                  <div>• All amounts are subject to VAT as applicable</div>
                  <div>• This is a proforma invoice and does not constitute a tax invoice</div>
                </div>
              </div>

              {/* Footer */}
              <div className="text-center text-sm text-gray-600 border-t pt-4 max-w-6xl mx-auto">
                <div>Thank you for your business!</div>
                <div>For questions regarding this proforma, please contact our billing department</div>
              </div>
            </div>
            {/* Print-only CSS */}
            <style>{`
              @media print {
                body * {
                  visibility: hidden !important;
                }
                #proforma-print-area, #proforma-print-area * {
                  visibility: visible !important;
                }
                #proforma-print-area {
                  position: absolute !important;
                  left: 0; top: 0; width: 100vw; min-height: 100vh;
                  background: white !important;
                  box-shadow: none !important;
                  margin: 0 !important;
                  border-radius: 0 !important;
                  z-index: 9999 !important;
                }
                .proforma-action-buttons {
                  display: none !important;
                }
              }
            `}</style>
          </div>
        </div>
      )}
    </div>
  );
};

export default CollectionPage; 