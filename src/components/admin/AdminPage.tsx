import React, { useState, useRef, useEffect } from 'react';
import { ChevronDownIcon } from '@heroicons/react/24/outline';
import ContractTemplatesManager from './ContractTemplatesManager';
import UserManagement from './UserManagement';
import PaymentPlanRowsManager from './PaymentPlanRowsManager';

const ADMIN_TABS = [
  {
    label: 'Accounting',
    subcategories: ['Currencies', 'Currency rates', 'Money accounts', 'Vats'],
  },
  {
    label: 'Authentication',
    subcategories: ['Groups', 'Users'],
  },
  {
    label: 'Finances',
    subcategories: ['Payment plan rows'],
  },
  {
    label: 'Hooks',
    subcategories: ['Access Logs'],
  },
  {
    label: 'Leads',
    subcategories: ['Anchors', 'Contacts', 'Leads'],
  },
  {
    label: 'Marketing',
    subcategories: ['Marketing expenses', 'Marketing suppliers', 'Sales team expenses'],
  },
  {
    label: 'Misc',
    subcategories: [
      'Bonus formulas', 'Contract templates', 'Countries', 'Email Templates', 'Holidays', 'Languages', 'Lead Stage Reasons', 'Lead Sources', 'Lead Tags', 'Main Categories', 'Public messages', 'sub categories', 'whatsapp template olds'
    ],
  },
  {
    label: 'Tenants',
    subcategories: ['Bank accounts', 'Departements', 'Employees', 'Firms', 'Meeting Locations'],
  },
  {
    label: 'Whatsapp',
    subcategories: ['Whatsapp numbers', 'Whats app templates'],
  },
];

// Type for leads
type Lead = { id: number; name: string; email: string; phone: string; stage: string; number: string };

const AdminPage: React.FC = () => {
  const [openTab, setOpenTab] = useState<number | null>(null);
  const [selected, setSelected] = useState<{ tab: number | null; sub: number | null }>({ tab: null, sub: null });
  const tabBarRef = useRef<HTMLDivElement>(null);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(false);

  // Arrow visibility logic
  useEffect(() => {
    const checkArrows = () => {
      const el = tabBarRef.current;
      if (!el) return;
      setShowLeftArrow(el.scrollLeft > 2);
      setShowRightArrow(el.scrollWidth - el.clientWidth - el.scrollLeft > 2);
    };
    checkArrows();
    window.addEventListener('resize', checkArrows);
    if (tabBarRef.current) {
      tabBarRef.current.addEventListener('scroll', checkArrows);
    }
    return () => {
      window.removeEventListener('resize', checkArrows);
      if (tabBarRef.current) {
        tabBarRef.current.removeEventListener('scroll', checkArrows);
      }
    };
  }, [ADMIN_TABS.length]);

  const scrollTabs = (dir: 'left' | 'right') => {
    const el = tabBarRef.current;
    if (!el) return;
    const scrollAmount = el.clientWidth * 0.7;
    el.scrollBy({ left: dir === 'left' ? -scrollAmount : scrollAmount, behavior: 'smooth' });
  };

  // Mock data for users
  const newUsers = [
    { name: 'Eliran Novik', email: 'eliran@example.com', date: '2024-06-10' },
    { name: 'Anna Zh', email: 'anna@example.com', date: '2024-06-15' },
    { name: 'Sarah L', email: 'sarah@example.com', date: '2024-06-18' },
    { name: 'David K', email: 'david@example.com', date: '2024-06-22' },
  ];
  const unactivatedUsers = [
    { name: 'Michael R', email: 'michael@example.com', date: '2024-06-12' },
    { name: 'Yael T', email: 'yael@example.com', date: '2024-06-20' },
  ];

  // Mock data for access logs
  const accessLogs = [
    {
      date: '01.07.25 16:06',
      method: 'POST',
      endpoint: 'hooks/catch/',
      body: "{name: 'Anil chauhan', phone: '966557802168', email: 'anilchauhan678ch@gmail.com', desc: 'How can I get a free working visa in Israel?', lead_source: '784', topic: 'For working visa in Israel', sid: '1311'}",
      code: 200,
    },
    {
      date: '01.07.25 15:44',
      method: 'GET',
      endpoint: 'api/users',
      body: '{}',
      code: 200,
    },
    {
      date: '01.07.25 15:40',
      method: 'POST',
      endpoint: 'api/login',
      body: "{email: 'anna@example.com', password: '***'}",
      code: 401,
    },
  ];

  // Mock data for leads
  const mockLeads: Lead[] = [
    { id: 1, name: 'David Lee', email: 'david.lee@example.com', phone: '050-1234567', stage: 'New', number: 'L1001' },
    { id: 2, name: 'Emma Wilson', email: 'emma.wilson@example.com', phone: '050-2345678', stage: 'Qualified', number: 'L1002' },
    { id: 3, name: 'Noah Cohen', email: 'noah.cohen@example.com', phone: '050-3456789', stage: 'Meeting', number: 'L1003' },
    { id: 4, name: 'Olivia Levi', email: 'olivia.levi@example.com', phone: '050-4567890', stage: 'Signed', number: 'L1004' },
  ];
  const [leadSearch, setLeadSearch] = React.useState('');
  const [selectedLead, setSelectedLead] = React.useState<Lead | null>(null);
  const filteredLeads = leadSearch.length > 0 ? mockLeads.filter(l => l.name.toLowerCase().includes(leadSearch.toLowerCase()) || l.number.includes(leadSearch)) : [];

  return (
    <div className="p-6 w-full">
      <h1 className="text-3xl font-bold mb-8">Admin Panel</h1>
      <div className="relative" style={{ minHeight: 48 }}>
        {/* Left Arrow */}
        {showLeftArrow && (
          <button
            className="absolute left-0 top-0 bottom-0 z-20 flex items-center px-1 bg-gradient-to-r from-white/90 via-white/60 to-transparent hover:bg-white/80 shadow-md rounded-l-xl"
            style={{ height: '100%' }}
            onClick={() => scrollTabs('left')}
            aria-label="Scroll left"
          >
            <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
        )}
        {/* Right Arrow */}
        {showRightArrow && (
          <button
            className="absolute right-0 top-0 bottom-0 z-20 flex items-center px-1 bg-gradient-to-l from-white/90 via-white/60 to-transparent hover:bg-white/80 shadow-md rounded-r-xl"
            style={{ height: '100%' }}
            onClick={() => scrollTabs('right')}
            aria-label="Scroll right"
          >
            <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          </button>
        )}
        <div
          ref={tabBarRef}
          className="flex border-b border-base-200 mb-0 gap-3 flex-nowrap scrollbar-hide shadow-sm overflow-x-auto"
          style={{
            WebkitOverflowScrolling: 'touch',
            minHeight: 0,
            overflowX: openTab !== null ? 'visible' : 'auto',
            height: 48,
          }}
        >
          {ADMIN_TABS.map((tab, i) => {
            const isOpen = openTab === i;
            return (
              <div key={tab.label} className="relative flex-shrink-0">
                <button
                  className={`flex items-center gap-1 px-3 py-2 sm:px-4 sm:py-2 text-base sm:text-lg font-semibold border-b-2 transition-colors whitespace-nowrap min-w-max
                    ${isOpen ? 'border-primary text-primary bg-base-100' : 'border-transparent text-base-content/70 hover:text-primary hover:bg-base-200'}`}
                  style={{ outline: 'none' }}
                  onClick={() => setOpenTab(isOpen ? null : i)}
                >
                  {tab.label}
                  <ChevronDownIcon
                    className={`w-5 h-5 ml-2 transition-transform duration-200 ${isOpen ? 'rotate-180 text-primary' : 'text-base-content/60'}`}
                    aria-hidden="true"
                  />
                </button>
                {/* Subcategories dropdown under the open tab (vertical list) */}
                {isOpen && (
                  <div className="absolute left-0 top-full z-50 bg-base-100 border-b border-x border-base-200 rounded-b-xl shadow-lg flex flex-col w-48 py-2 animate-fade-in max-h-80 overflow-y-auto">
                    {tab.subcategories.map((sub, j) => (
                      <button
                        key={sub}
                        className={`w-full text-left px-3 py-2 text-sm font-medium rounded-md transition-colors whitespace-nowrap
                          ${selected.tab === i && selected.sub === j
                            ? 'bg-primary text-white shadow'
                            : 'bg-base-200 text-base-content hover:bg-primary/10 hover:text-primary'}`}
                        onClick={() => {
                          setSelected({ tab: i, sub: j });
                          setOpenTab(null);
                        }}
                      >
                        {sub}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {/* Feature Boxes Row - only show if no subcategory is selected */}
      {!(selected.tab !== null && selected.sub !== null) && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8 mb-8">
          {/* Users (Last 30 Days) */}
          <div className="card shadow-xl rounded-2xl hover:shadow-2xl transition-all duration-200 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white relative overflow-hidden">
            <div className="card-body p-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="avatar placeholder">
                  <div className="bg-white/20 text-white rounded-xl w-10 h-10 flex items-center justify-center">
                    <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m9-4a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
                  </div>
                </div>
                <span className="card-title text-lg text-white">Users (Last 30 Days)</span>
              </div>
              <div className="divider my-2 before:bg-white/30 after:bg-white/30 text-white/80">New Users</div>
              <ul className="space-y-1 mb-2">
                {newUsers.map(u => (
                  <li key={u.email} className="flex items-center gap-2 text-sm">
                    <span className="font-bold text-white">{u.name}</span>
                    <span className="text-white/80">({u.email})</span>
                    <span className="badge badge-success badge-sm ml-auto bg-white/20 border-none text-white">{u.date}</span>
                  </li>
                ))}
              </ul>
              <div className="divider my-2 text-error before:bg-white/30 after:bg-white/30 text-white/80">Unactivated</div>
              <ul className="space-y-1">
                {unactivatedUsers.map(u => (
                  <li key={u.email} className="flex items-center gap-2 text-sm">
                    <span className="font-bold text-white">{u.name}</span>
                    <span className="text-white/80">({u.email})</span>
                    <span className="badge badge-error badge-sm ml-auto bg-white/20 border-none text-white">{u.date}</span>
                  </li>
                ))}
              </ul>
              {/* SVG Graph Placeholder */}
              <svg className="absolute bottom-4 right-4 w-16 h-8 opacity-60" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 64 32"><path d="M2 28 Q16 8 32 20 T62 8" /></svg>
            </div>
          </div>
          {/* Access Logs */}
          <div className="card shadow-xl rounded-2xl hover:shadow-2xl transition-all duration-200 bg-gradient-to-tr from-purple-600 via-blue-600 to-blue-500 text-white relative overflow-hidden">
            <div className="card-body p-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="avatar placeholder">
                  <div className="bg-white/20 text-white rounded-xl w-10 h-10 flex items-center justify-center">
                    <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V4a2 2 0 10-4 0v1.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
                  </div>
                </div>
                <span className="card-title text-lg text-white">Access Logs</span>
              </div>
              <div className="overflow-x-auto mt-2 rounded-lg bg-white/10">
                <table className="table table-xs w-full text-xs text-white">
                  <thead>
                    <tr className="text-white/80">
                      <th className="font-bold">Date</th>
                      <th className="font-bold">Method</th>
                      <th className="font-bold">Endpoint</th>
                      <th className="font-bold">Request Body</th>
                      <th className="font-bold">Code</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accessLogs.map((log, idx) => (
                      <tr key={idx} className="border-b border-white/20 hover:bg-white/10">
                        <td className="whitespace-nowrap text-info font-mono font-bold">{log.date}</td>
                        <td><span className={`badge ${log.method === 'POST' ? 'badge-error' : 'badge-info'} badge-sm bg-white/20 border-none text-white`}>{log.method}</span></td>
                        <td className="font-mono">{log.endpoint}</td>
                        <td className="font-mono text-xs max-w-xs overflow-x-hidden whitespace-nowrap text-ellipsis" title={log.body}>{log.body}</td>
                        <td><span className={`badge ${log.code === 200 ? 'badge-success' : 'badge-error'} badge-sm bg-white/20 border-none text-white`}>{log.code}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* SVG Bar Chart Placeholder */}
              <svg className="absolute bottom-4 right-4 w-12 h-8 opacity-60" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 48 32"><rect x="2" y="20" width="4" height="10"/><rect x="10" y="10" width="4" height="20"/><rect x="18" y="16" width="4" height="14"/><rect x="26" y="6" width="4" height="24"/><rect x="34" y="14" width="4" height="16"/></svg>
            </div>
          </div>
          {/* Leads Settings */}
          <div className="card shadow-xl rounded-2xl hover:shadow-2xl transition-all duration-200 bg-gradient-to-tr from-blue-500 via-cyan-500 to-teal-400 text-white relative overflow-hidden">
            <div className="card-body p-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="avatar placeholder">
                  <div className="bg-white/20 text-white rounded-xl w-10 h-10 flex items-center justify-center">
                    <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 1.343-3 3s1.343 3 3 3 3-1.343 3-3-1.343-3-3-3zm0 10c-4.418 0-8-1.79-8-4V6a2 2 0 012-2h12a2 2 0 012 2v8c0 2.21-3.582 4-8 4z" /></svg>
                  </div>
                </div>
                <span className="card-title text-lg text-white">Leads Settings</span>
              </div>
              {/* Lead Search */}
              <div className="mb-2 relative">
                <input
                  type="text"
                  className="input input-bordered input-sm w-full bg-white/20 text-white placeholder-white/70 border-white/30 focus:border-white/60"
                  placeholder="Search lead by name or number..."
                  value={leadSearch}
                  onChange={e => {
                    setLeadSearch(e.target.value);
                    setSelectedLead(null);
                  }}
                />
                {leadSearch && filteredLeads.length > 0 && (
                  <div className="absolute bg-white/90 text-base-content border border-white/30 rounded-xl shadow-lg mt-1 w-full z-50 max-h-40 overflow-y-auto">
                    {filteredLeads.map(lead => (
                      <button
                        key={lead.id}
                        className="block w-full text-left px-4 py-2 hover:bg-primary/10"
                        onClick={() => setSelectedLead(lead)}
                      >
                        <span className="font-bold text-primary">{lead.number}</span> - {lead.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {/* Lead Info */}
              {selectedLead && (
                <div className="bg-white/20 rounded-lg p-3 mb-2 mt-1">
                  <div className="font-bold text-white text-lg">{selectedLead.name} <span className="text-white/70">({selectedLead.number})</span></div>
                  <div className="text-sm text-white/90">Email: {selectedLead.email}</div>
                  <div className="text-sm text-white/90">Phone: {selectedLead.phone}</div>
                  <div className="text-sm text-white/90">Stage: <span className="badge badge-outline ml-1 border-white/60 text-white/90">{selectedLead.stage}</span></div>
                  <button className="btn btn-primary btn-sm mt-2">Settings</button>
                </div>
              )}
              {/* Quick links */}
              <div className="card-actions flex flex-wrap gap-2 mt-2">
                <div className="btn-group">
                  <button className="btn btn-outline btn-sm border-white/40 text-white hover:bg-white/10" type="button">Lead Tags</button>
                  <button className="btn btn-outline btn-sm border-white/40 text-white hover:bg-white/10" type="button">Lead Sources</button>
                  <button className="btn btn-outline btn-sm border-white/40 text-white hover:bg-white/10" type="button">Lead Stage Reasons</button>
                  <button className="btn btn-outline btn-sm border-white/40 text-white hover:bg-white/10" type="button">Main Categories</button>
                  <button className="btn btn-outline btn-sm border-white/40 text-white hover:bg-white/10" type="button">Sub Categories</button>
                </div>
              </div>
              {/* SVG Line Chart Placeholder */}
              <svg className="absolute bottom-4 right-4 w-16 h-8 opacity-60" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 64 32"><polyline points="2,28 16,20 32,24 48,10 62,18" /></svg>
            </div>
          </div>
        </div>
      )}
      {/* Content Area */}
      <div className="bg-base-100 rounded-xl shadow p-8 min-h-[200px] mt-8">
        {selected.tab !== null && selected.sub !== null ? (
          ADMIN_TABS[selected.tab].label === 'Misc' &&
          ADMIN_TABS[selected.tab].subcategories[selected.sub] === 'Contract templates' ? (
            <div className="w-full"><ContractTemplatesManager /></div>
          ) : ADMIN_TABS[selected.tab].label === 'Authentication' &&
          ADMIN_TABS[selected.tab].subcategories[selected.sub] === 'Users' ? (
            <div className="w-full"><UserManagement /></div>
          ) : ADMIN_TABS[selected.tab].label === 'Finances' &&
          ADMIN_TABS[selected.tab].subcategories[selected.sub] === 'Payment plan rows' ? (
            <div className="w-full"><PaymentPlanRowsManager /></div>
          ) : (
            <div className="flex items-center justify-center text-xl font-semibold text-primary">
              {`${ADMIN_TABS[selected.tab].label} / ${ADMIN_TABS[selected.tab].subcategories[selected.sub]}`}
              <span className="ml-4 text-base text-base-content/60 font-normal">(Placeholder content)</span>
            </div>
          )
        ) : openTab !== null ? (
          <div className="flex items-center justify-center text-xl font-semibold text-primary">
            <span className="text-base text-base-content/60 font-normal">Select a subcategory</span>
          </div>
        ) : (
          <div className="flex items-center justify-center text-xl font-semibold text-primary">
            Select a category
          </div>
        )}
      </div>
      {/* Glassy card style */}
      <style>{`
        .glass-card {
          background: rgba(255,255,255,0.70);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border-radius: 1.25rem;
          box-shadow: 0 4px 24px 0 rgba(0,0,0,0.08), 0 1.5px 8px 0 rgba(0,0,0,0.04);
          transition: box-shadow 0.2s, transform 0.2s;
        }
      `}</style>
    </div>
  );
};

export default AdminPage; 