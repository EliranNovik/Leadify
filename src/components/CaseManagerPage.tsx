import React, { useState } from 'react';
import {
  UserIcon,
  HashtagIcon,
  EnvelopeIcon,
  PhoneIcon,
  DocumentTextIcon,
  ChevronDownIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  ClockIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';
import Tree from 'react-d3-tree';
import { createPortal } from 'react-dom';

const mockCase = {
  name: 'Sarah Müller',
  stage: 'In Progress',
  case_number: 'C-2024-001',
  email: 'sarah.mueller@email.com',
  phone: '+49 123 456789',
  category: 'Citizenship',
  topic: 'German Citizenship',
};

const tabs = [
  { id: 'dashboard', label: 'Dashboard', icon: UserIcon },
  { id: 'details', label: 'Case Details', icon: DocumentTextIcon },
  { id: 'documents', label: 'Document Manager', icon: DocumentTextIcon },
  { id: 'interactions', label: 'Interactions', icon: DocumentTextIcon },
  { id: 'application', label: 'Application', icon: DocumentTextIcon },
  { id: 'tasks', label: 'Task Manager', icon: DocumentTextIcon },
  { id: 'settings', label: 'Settings', icon: DocumentTextIcon },
] as const;

type TabId = typeof tabs[number]['id'];

const getStageBadge = (stage: string) => (
  <span className="badge badge-primary badge-lg ml-2">{stage}</span>
);

// Mock family tree data (fixed hierarchy, now with idNumber, maritalStatus, email, phone)
const familyTree = [
  {
    id: 3,
    name: 'Frieda Müller',
    relationship: '(Persecuted Ancestor)',
    dob: '1920-01-10',
    idNumber: 'A1234567',
    status: 'Deceased',
    maritalStatus: 'Married',
    email: 'frieda.mueller@email.com',
    phone: '+49 111 222333',
    isMain: false,
    isPersecuted: true,
    docs: { birth: true, marriage: true },
    parentId: null,
    avatar: 'FM',
  },
  {
    id: 2,
    name: 'Heinrich Müller',
    relationship: 'Child',
    dob: '1950-03-22',
    idNumber: 'B2345678',
    status: 'Not Applying',
    maritalStatus: 'Married',
    email: 'heinrich.mueller@email.com',
    phone: '+49 222 333444',
    isMain: false,
    isPersecuted: false,
    docs: { birth: true, marriage: true },
    parentId: 3,
    avatar: 'HM',
  },
  {
    id: 5,
    name: 'Anna Müller',
    relationship: 'Child',
    dob: '1952-07-18',
    idNumber: 'C3456789',
    status: 'Not Applying',
    maritalStatus: 'Married',
    email: 'anna.mueller@email.com',
    phone: '+49 333 444555',
    isMain: false,
    isPersecuted: false,
    docs: { birth: true, marriage: true },
    parentId: 3,
    avatar: 'AM',
  },
  {
    id: 1,
    name: 'Sarah Müller',
    relationship: 'Granddaughter',
    dob: '1980-05-12',
    idNumber: 'D4567890',
    status: 'Applying',
    maritalStatus: 'Single',
    email: 'sarah.mueller@email.com',
    phone: '+49 123 456789',
    isMain: true,
    isPersecuted: false,
    docs: { birth: true, marriage: false },
    parentId: 2, // For simplicity, use father as parent
    avatar: 'SM',
  },
  {
    id: 4,
    name: 'Jonas Müller',
    relationship: 'Grandson',
    dob: '1982-09-30',
    idNumber: 'E5678901',
    status: 'Applying',
    maritalStatus: 'Single',
    email: 'jonas.mueller@email.com',
    phone: '+49 555 666777',
    isMain: false,
    isPersecuted: false,
    docs: { birth: false, marriage: false },
    parentId: 2, // For simplicity, use father as parent
    avatar: 'JM',
  },
];

// Helper to convert flat familyTree to react-d3-tree hierarchical format (supports forest)
function buildTree(flatData: any[]) {
  const idToNode: Record<number, any> = {};
  flatData.forEach(p => { idToNode[p.id] = { ...p, children: [] }; });
  const roots: any[] = [];
  flatData.forEach(p => {
    if (p.parentId && idToNode[p.parentId]) {
      idToNode[p.parentId].children.push(idToNode[p.id]);
    } else if (!p.parentId) {
      roots.push(idToNode[p.id]);
    }
  });
  // If only one root, return the object; if multiple, return array (forest)
  return roots.length === 1 ? roots[0] : roots;
}

// Custom node renderer: glassy, modern, clickable, professional
const renderCustomNode = (
  { nodeDatum, toggleNode, hierarchyPointNode }: any,
  drawerHandler: any
) => (
  <g
    style={{ cursor: 'pointer' }}
    onClick={() => drawerHandler(nodeDatum)}
    onMouseEnter={e => {
      const rect = (e.currentTarget.querySelector('rect[data-main]') as SVGRectElement);
      if (rect) rect.setAttribute('stroke', '#6366f1');
    }}
    onMouseLeave={e => {
      const rect = (e.currentTarget.querySelector('rect[data-main]') as SVGRectElement);
      if (rect) rect.setAttribute('stroke', '#e5e7eb');
    }}
  >
    {/* Glassmorphism Card */}
    <rect
      data-main
      width="240"
      height="140"
      x="-120"
      y="-70"
      rx="24"
      fill="#fff"
      fillOpacity="0.85"
      stroke="#e5e7eb"
      strokeWidth="2.5"
      style={{ filter: 'drop-shadow(0 4px 24px rgba(59,40,199,0.10)) blur(0.5px)' }}
    />
    {/* Card Content */}
    <foreignObject x="-110" y="-60" width="220" height="120" style={{ overflow: 'visible' }}>
      <div
        style={{
          width: '100%',
          minHeight: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'Inter, system-ui, sans-serif',
          padding: 8,
          overflow: 'visible',
          whiteSpace: 'normal',
          wordBreak: 'break-word',
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 18, color: '#222', marginBottom: 2, textAlign: 'center', lineHeight: 1.1 }}>{nodeDatum.name}</div>
        <div style={{ fontWeight: 500, fontSize: 13, color: '#6366f1', marginBottom: 4, textAlign: 'center' }}>{nodeDatum.relationship}</div>
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 2 }}>ID: {nodeDatum.idNumber}</div>
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>Born: {nodeDatum.dob}</div>
        <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
          {nodeDatum.isMain && (
            <span style={{
              background: 'linear-gradient(90deg, #6366f1 60%, #818cf8 100%)',
              color: '#fff',
              fontWeight: 600,
              fontSize: 11,
              borderRadius: 9999,
              padding: '2px 12px',
              boxShadow: '0 1px 6px 0 rgba(99,102,241,0.10)',
              letterSpacing: 0.2,
              marginRight: 2,
            }}>Main Applicant</span>
          )}
          {nodeDatum.isPersecuted && (
            <span style={{
              background: 'linear-gradient(90deg, #ef4444 60%, #f87171 100%)',
              color: '#fff',
              fontWeight: 600,
              fontSize: 11,
              borderRadius: 9999,
              padding: '2px 12px',
              boxShadow: '0 1px 6px 0 rgba(239,68,68,0.10)',
              letterSpacing: 0.2,
              marginLeft: 2,
            }}>Persecuted</span>
          )}
        </div>
      </div>
    </foreignObject>
    {/* Hover Glow (SVG only, not CSS) */}
    <rect
      width="240"
      height="140"
      x="-120"
      y="-70"
      rx="24"
      fill="none"
      stroke="#6366f1"
      strokeWidth="0"
      className="node-hover-outline"
      pointerEvents="none"
    />
  </g>
);

const CaseDetailsContent = () => {
  const [selectedPerson, setSelectedPerson] = useState<any | null>(null);
  const [noteEdit, setNoteEdit] = useState('');
  const [isEditingNote, setIsEditingNote] = useState(false);
  const [personNotes, setPersonNotes] = useState<Record<number, string>>({});
  const [uploadedFiles, setUploadedFiles] = useState<any[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const treeData = buildTree(familyTree);

  // Handler for node click
  const handleNodeClick = (person: any) => {
    setSelectedPerson(person);
    setNoteEdit(personNotes[person.id] || '');
    setIsEditingNote(false);
  };

  // Mock tasks per person
  const mockTasks = [
    { name: 'Upload Birth Certificate', due: '2024-07-10', done: false },
    { name: 'Sign Application Form', due: '2024-07-15', done: true },
    { name: 'Submit Police Certificate', due: '2024-07-20', done: false },
  ];

  // Drag and drop handlers (UI only)
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    const files = Array.from(e.dataTransfer.files);
    setUploadedFiles(prev => [...prev, ...files]);
  };
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(true);
  };
  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
  };
  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      setUploadedFiles(prev => [...prev, ...Array.from(files)]);
    }
  };

  return (
    <div className="space-y-8">
      {/* Family Tree Visualization */}
      <div
        className="w-full flex justify-center items-start pb-4"
        style={{ width: '100%', height: '70vh', minWidth: 700, minHeight: 400 }}
      >
        <div style={{ width: '100%', height: '100%' }}>
          <Tree
            data={treeData ? treeData : []}
            orientation="vertical"
            translate={{ x: 900, y: 100 }}
            renderCustomNodeElement={(rd) => renderCustomNode(rd, handleNodeClick)}
            pathFunc="elbow"
            zoomable={false}
            collapsible={false}
            separation={{ siblings: 2.2, nonSiblings: 2.8 }}
            nodeSize={{ x: 260, y: 160 }}
            pathClassFunc={() => 'tree-connection'}
          />
        </div>
      </div>
      {/* Add Applicant/Ancestor Buttons */}
      <div className="flex gap-4 mt-2">
        <button className="btn btn-primary btn-sm">Add Applicant</button>
        <button className="btn btn-outline btn-primary btn-sm">Add Ancestor</button>
      </div>
      {/* Details Drawer/Panel (opens on node click) */}
      {selectedPerson && createPortal(
        <div className="fixed inset-0 z-50 flex">
          {/* Overlay */}
          <div className="fixed inset-0 bg-black/30 transition-opacity duration-300" onClick={() => setSelectedPerson(null)} />
          {/* Drawer */}
          <div className="ml-auto w-full max-w-xl bg-white h-full shadow-2xl p-8 flex flex-col animate-slideInRight z-50 rounded-l-2xl relative" style={{ boxShadow: '0 0 40px 0 rgba(0,0,0,0.2)' }}>
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <span className="text-2xl font-bold">{selectedPerson.name}</span>
                {selectedPerson.isMain && <span className="badge badge-primary">Main Applicant</span>}
                {selectedPerson.isPersecuted && <span className="badge badge-error">Persecuted Ancestor</span>}
              </div>
              <button className="btn btn-ghost btn-circle" onClick={() => setSelectedPerson(null)}>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="flex flex-col gap-6 flex-1 overflow-y-auto pr-2">
              {/* Details Grid */}
              <div className="grid grid-cols-2 gap-4 mb-2">
                <div>
                  <div className="font-semibold text-base-content/70">Relationship</div>
                  <div className="text-base font-medium">{selectedPerson.relationship}</div>
                </div>
                <div>
                  <div className="font-semibold text-base-content/70">ID Number</div>
                  <div className="text-base font-medium">{selectedPerson.idNumber}</div>
                </div>
                <div>
                  <div className="font-semibold text-base-content/70">Birth Date</div>
                  <div className="text-base font-medium">{selectedPerson.dob}</div>
                </div>
                <div>
                  <div className="font-semibold text-base-content/70">Status</div>
                  <div className="text-base font-medium">{selectedPerson.status}</div>
                </div>
                <div>
                  <div className="font-semibold text-base-content/70">Marital Status</div>
                  <div className="text-base font-medium">{selectedPerson.maritalStatus}</div>
                </div>
              </div>
              {/* Contact Info */}
              <div className="flex gap-8 mb-2">
                <div>
                  <div className="font-semibold text-base-content/70">Email</div>
                  <div className="text-base font-medium break-all">{selectedPerson.email}</div>
                </div>
                <div>
                  <div className="font-semibold text-base-content/70">Phone</div>
                  <div className="text-base font-medium">{selectedPerson.phone}</div>
                </div>
              </div>
              {/* Badges */}
              <div className="flex flex-wrap gap-2 mb-2">
                <span className="badge badge-info badge-sm">{selectedPerson.status}</span>
                {selectedPerson.isMain && <span className="badge badge-primary badge-sm">Main Applicant</span>}
                {selectedPerson.isPersecuted && <span className="badge badge-error badge-sm">Persecuted Ancestor</span>}
              </div>
              {/* Tasks Section */}
              <div>
                <div className="font-semibold text-base-content/70 mb-1">Tasks</div>
                <ul className="space-y-2">
                  {mockTasks.map((task, idx) => (
                    <li key={idx} className="flex items-center gap-3">
                      <input type="checkbox" checked={task.done} readOnly className="checkbox checkbox-sm" />
                      <span className={`font-medium ${task.done ? 'line-through text-base-content/50' : ''}`}>{task.name}</span>
                      <span className="badge badge-outline badge-xs ml-auto">Due: {task.due}</span>
                    </li>
                  ))}
                </ul>
              </div>
              {/* Drag & Drop Document Upload */}
              <div>
                <div className="font-semibold text-base-content/70 mb-1">Upload Documents</div>
                <div
                  className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors duration-200 ${dragActive ? 'bg-primary/10 border-primary' : 'bg-base-200'}`}
                  onDragOver={handleDragOver}
                  onDragEnter={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                >
                  <div className="mb-2 text-base-content/70">Drag and drop files here, or click to select files</div>
                  <input
                    type="file"
                    className="hidden"
                    id="drawer-file-upload"
                    multiple
                    onChange={handleFileInput}
                  />
                  <label htmlFor="drawer-file-upload" className="btn btn-outline btn-primary btn-sm mt-2">Choose Files</label>
                  <div className="mt-4 space-y-1">
                    {uploadedFiles.length > 0 && uploadedFiles.map((file, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-sm">
                        <span className="font-medium">{file.name || file.toString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              {/* Documents Section */}
              <div>
                <div className="font-semibold text-base-content/70 mb-1">Documents</div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className={`badge badge-xs ${selectedPerson.docs.birth ? 'badge-success' : 'badge-outline'}`}>Birth Certificate</span>
                    <span className="text-xs text-base-content/60">{selectedPerson.docs.birth ? 'Uploaded' : 'Missing'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`badge badge-xs ${selectedPerson.docs.marriage ? 'badge-success' : 'badge-outline'}`}>Marriage Certificate</span>
                    <span className="text-xs text-base-content/60">{selectedPerson.docs.marriage ? 'Uploaded' : 'Missing'}</span>
                  </div>
                </div>
              </div>
              {/* Notes Section */}
              <div>
                <div className="font-semibold text-base-content/70 mb-1">Notes</div>
                {!isEditingNote ? (
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-base-200 rounded-lg p-3 min-h-[48px] text-base-content/90">{personNotes[selectedPerson.id] || '[No notes yet. Click edit to add.]'}</div>
                    <button className="btn btn-ghost btn-xs" onClick={() => { setIsEditingNote(true); setNoteEdit(personNotes[selectedPerson.id] || ''); }}>
                      Edit
                    </button>
                  </div>
                ) : (
                  <div>
                    <textarea
                      className="textarea textarea-bordered w-full h-24 mb-2"
                      value={noteEdit}
                      onChange={e => setNoteEdit(e.target.value)}
                    />
                    <div className="flex gap-2 justify-end">
                      <button className="btn btn-ghost btn-xs" onClick={() => setIsEditingNote(false)}>Cancel</button>
                      <button className="btn btn-primary btn-xs" onClick={() => { setPersonNotes(prev => ({ ...prev, [selectedPerson.id]: noteEdit })); setIsEditingNote(false); }}>Save</button>
                    </div>
                  </div>
                )}
              </div>
              {/* Other Details Section */}
              <div>
                <div className="font-semibold text-base-content/70 mb-1">Other Details</div>
                <div className="bg-base-200 rounded-lg p-4 text-base-content/90 min-h-[48px]">
                  [Additional data, notes, and actions can go here.]
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

// Stylish dashboard content
const DashboardContent = () => {
  // Mock tasks data
  const tasks = [
    { name: 'Submit Police Certificate', due: '2024-07-10', color: 'text-error' },
    { name: 'Upload Birth Certificate', due: '2024-07-15', color: 'text-warning' },
    { name: 'Sign Application Form', due: '2024-07-20', color: 'text-success' },
  ];

  return (
    <div className="space-y-8">
      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-2xl shadow p-6 flex flex-col items-center">
          <span className="text-4xl font-bold text-primary">8</span>
          <span className="mt-2 text-base-content/70">Documents Received</span>
          <span className="text-xs text-success mt-1">Successfully uploaded</span>
        </div>
        <div className="bg-white rounded-2xl shadow p-6 flex flex-col items-center">
          <span className="text-4xl font-bold text-warning">3</span>
          <span className="mt-2 text-base-content/70">Pending Documents</span>
          <span className="text-xs text-warning mt-1">Awaiting submission</span>
        </div>
        <div className="bg-white rounded-2xl shadow p-6 flex flex-col items-center">
          <span className="text-4xl font-bold text-error">2</span>
          <span className="mt-2 text-base-content/70">Missing Documents</span>
          <span className="text-xs text-error mt-1">Requires attention</span>
        </div>
      </div>

      {/* Progress and Urgent Documents */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Case Progress */}
        <div className="bg-white rounded-2xl shadow p-6">
          <div className="flex items-center gap-2 mb-4">
            <DocumentTextIcon className="w-5 h-5 text-primary" />
            <span className="font-semibold text-lg">Case Progress</span>
          </div>
          <div className="flex items-center justify-between mb-2">
            <span className="font-medium">Overall Progress</span>
            <span className="text-primary font-bold">65%</span>
          </div>
          <progress className="progress progress-primary w-full h-3 mb-4" value={65} max="100"></progress>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="bg-base-200 rounded-lg p-4 flex flex-col items-center">
              <span className="text-info text-2xl font-bold">45</span>
              <span className="text-xs mt-1">Days Active</span>
            </div>
            <div className="bg-base-200 rounded-lg p-4 flex flex-col items-center">
              <span className="text-warning text-2xl font-bold">14</span>
              <span className="text-xs mt-1">Days Left</span>
            </div>
          </div>
          <div className="alert alert-warning flex items-center gap-2 mt-2">
            <ExclamationTriangleIcon className="w-5 h-5" />
            <span className="font-bold">Deadline Approaching!</span>
            <span className="ml-2 text-xs">14 days until submission deadline</span>
          </div>
        </div>
        {/* Urgent Documents */}
        <div className="bg-white rounded-2xl shadow p-6">
          <div className="flex items-center gap-2 mb-4">
            <ExclamationTriangleIcon className="w-5 h-5 text-error" />
            <span className="font-semibold text-lg text-error">Urgent Documents</span>
          </div>
          <div className="space-y-3">
            <div className="bg-warning rounded-lg p-4 flex items-center justify-between">
              <div>
                <span className="font-bold">Birth Certificate</span>
                <span className="block text-xs text-base-content/70">Missing</span>
              </div>
              <span className="badge badge-warning text-xs">2d left</span>
            </div>
            <div className="bg-warning rounded-lg p-4 flex items-center justify-between">
              <div>
                <span className="font-bold">Police Certificate</span>
                <span className="block text-xs text-base-content/70">Pending</span>
              </div>
              <span className="badge badge-warning text-xs">5d left</span>
            </div>
            <div className="bg-error rounded-lg p-4 flex items-center justify-between">
              <div>
                <span className="font-bold text-white">Marriage Certificate</span>
                <span className="block text-xs text-white/80">Expired</span>
              </div>
              <span className="badge badge-error text-xs">OVERDUE</span>
            </div>
          </div>
          <div className="flex justify-end mt-4">
            <button className="btn btn-outline btn-primary btn-sm">View All Documents</button>
          </div>
        </div>
      </div>

      {/* Latest Tasks Due */}
      <div className="bg-white rounded-2xl shadow p-6">
        <div className="flex items-center gap-2 mb-4">
          <ClockIcon className="w-5 h-5 text-primary" />
          <span className="font-semibold text-lg">Latest Tasks Due</span>
        </div>
        <div className="space-y-3">
          {tasks.map((task, idx) => (
            <div key={idx} className="flex items-center justify-between bg-base-100 rounded-lg p-4 shadow-sm">
              <div className="flex items-center gap-3">
                <CheckCircleIcon className={`w-6 h-6 ${task.color}`} />
                <span className="font-medium text-base-content text-base">{task.name}</span>
              </div>
              <div className="text-right">
                <div className="text-xs text-base-content/70">Due Date</div>
                <div className={`text-base font-bold ${task.color}`}>{task.due}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Notes & History */}
      <div className="bg-white rounded-2xl shadow p-6">
        <div className="flex items-center gap-2 mb-4">
          <ClockIcon className="w-5 h-5 text-primary" />
          <span className="font-semibold text-lg">Notes & History</span>
        </div>
        <div className="space-y-4">
          <div className="chat chat-start">
            <div className="chat-image avatar placeholder">
              <div className="bg-primary text-primary-content rounded-full w-10">
                <span className="text-sm">JD</span>
              </div>
            </div>
            <div className="chat-bubble bg-base-200">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-medium text-sm">John Doe</span>
                <span className="text-xs opacity-70">2 hours ago</span>
              </div>
              <p className="text-sm">Client confirmed receipt of document request email</p>
            </div>
          </div>
          <div className="chat chat-start">
            <div className="chat-image avatar placeholder">
              <div className="bg-primary text-primary-content rounded-full w-10">
                <span className="text-sm">JS</span>
              </div>
            </div>
            <div className="chat-bubble bg-base-200">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-medium text-sm">Jane Smith</span>
                <span className="text-xs opacity-70">1 day ago</span>
              </div>
              <p className="text-sm">Birth certificate translation completed and uploaded</p>
            </div>
          </div>
          <div className="chat chat-start">
            <div className="chat-image avatar placeholder">
              <div className="bg-primary text-primary-content rounded-full w-10">
                <span className="text-sm">MJ</span>
              </div>
            </div>
            <div className="chat-bubble bg-base-200">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-medium text-sm">Mike Johnson</span>
                <span className="text-xs opacity-70">3 days ago</span>
              </div>
              <p className="text-sm">Initial consultation completed - client eligible for Section 5</p>
            </div>
          </div>
          <div className="flex justify-center mt-6">
            <button className="btn btn-outline btn-primary">View All Notes</button>
          </div>
        </div>
      </div>
    </div>
  );
};

const tabContent: Record<TabId, React.ReactNode> = {
  dashboard: <DashboardContent />,
  details: <CaseDetailsContent />,
  documents: <div>Document manager content goes here.</div>,
  interactions: <div>Interactions content goes here.</div>,
  application: <div>Application content goes here.</div>,
  tasks: <div>Task manager & calendar content goes here.</div>,
  settings: <div>Settings content goes here.</div>,
};

const CaseManagerPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');

  return (
    <div className="flex-1 min-h-screen bg-white">
      {/* Header Section */}
      <div className="border-b border-base-200 w-full px-4 pt-4 pb-2 bg-white rounded-t-2xl">
        <div className="w-full">
          <div className="flex flex-wrap md:flex-nowrap items-start justify-between gap-4">
            {/* Left side (name, stage badge) */}
            <div className="flex flex-col gap-2 flex-1 w-full">
              <div className="flex items-center">
                <h2 className="text-2xl font-bold">{mockCase.name}</h2>
                <span className="hidden md:inline-block ml-3 align-middle">{getStageBadge(mockCase.stage)}</span>
              </div>
              {/* Stage badge - mobile only */}
              <div className="block md:hidden w-full mt-1">{getStageBadge(mockCase.stage)}</div>
              {/* Case number */}
              <div className="flex items-center gap-2 mt-1">
                <HashtagIcon className="w-5 h-5 text-primary" />
                <span className="text-lg">{mockCase.case_number}</span>
              </div>
            </div>
          </div>
          {/* Contact and Category Info */}
          <div className="flex flex-col md:flex-row md:items-center bg-base-200/50 rounded-lg p-3 mt-4 md:mt-8">
            {/* Email */}
            <div className="flex items-start gap-2">
              <EnvelopeIcon className="w-5 h-5 text-primary mt-1" />
              <div>
                <div className="text-sm text-base-content/70">Email Address</div>
                <a href={`mailto:${mockCase.email}`} className="text-primary hover:underline break-all">
                  {mockCase.email}
                </a>
              </div>
            </div>
            {/* Separator */}
            <div className="hidden md:block h-8 w-px bg-base-300 mx-6" />
            {/* Phone */}
            <div className="flex items-start gap-2">
              <PhoneIcon className="w-5 h-5 text-primary mt-1" />
              <div>
                <div className="text-sm text-base-content/70">Phone Number</div>
                <a href={`tel:${mockCase.phone}`} className="text-primary hover:underline">
                  {mockCase.phone}
                </a>
              </div>
            </div>
            {/* Separator */}
            <div className="hidden md:block h-8 w-px bg-base-300 mx-6" />
            {/* Category and Topic */}
            <div className="flex items-start gap-2">
              <DocumentTextIcon className="w-5 h-5 text-primary mt-1" />
              <div>
                <div className="text-sm text-base-content/70">Category & Topic</div>
                <div className="flex items-center gap-2">
                  <span>{mockCase.category}</span>
                  <span className="text-base-content/70">•</span>
                  <span className="text-primary">{mockCase.topic}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* Tabs Navigation */}
      <div className="border-b border-base-200 bg-white">
        <div className="w-full">
          {/* Desktop version */}
          <ul className="tabs tabs-lifted mb-[-1px] gap-2 px-6 hidden md:flex">
            {tabs.map((tab) => (
              <li key={tab.id}>
                <button
                  className={`tab text-base font-medium px-6 py-4 ${activeTab === tab.id ? 'tab-active !border-base-200' : ''}`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  <div className="flex items-center gap-2">
                    <tab.icon className="w-5 h-5" />
                    <span>{tab.label}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
          {/* Mobile version */}
          <div className="md:hidden relative">
            <div className="overflow-x-auto scrollbar-hide -mx-2 px-2 py-3 flex items-center bg-base-200/80 rounded-2xl shadow-xl border border-base-300" style={{ WebkitOverflowScrolling: 'touch', backdropFilter: 'blur(6px)' }}>
              <ul className="flex gap-3 snap-x snap-mandatory w-full">
                {tabs.map((tab, idx) => {
                  const isActive = activeTab === tab.id;
                  return (
                    <li
                      key={tab.id}
                      className="snap-center flex-shrink-0 flex flex-col items-center justify-center"
                      data-tab-idx={idx}
                      style={{ width: 84, transition: 'width 0.2s' }}
                    >
                      <button
                        className={`flex items-center justify-center transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-primary/60 border-2 mb-1 ${isActive ? 'bg-black text-white border-black shadow-[0_4px_24px_0_rgba(0,0,0,0.10)]' : 'bg-white text-primary border-primary shadow-md hover:opacity-90'}`}
                        onClick={() => setActiveTab(tab.id)}
                        style={{
                          width: isActive ? 56 : 48,
                          height: isActive ? 56 : 48,
                          minWidth: isActive ? 56 : 48,
                          minHeight: isActive ? 48 : 48,
                          maxWidth: isActive ? 56 : 48,
                          maxHeight: isActive ? 56 : 48,
                          borderRadius: 12,
                          boxShadow: isActive ? '0 6px 24px 0 rgba(0,0,0,0.10), 0 0 0 2px #000' : undefined,
                          transition: 'box-shadow 0.25s, background 0.25s, color 0.25s, width 0.25s, height 0.25s',
                          padding: 0,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <tab.icon className={`w-6 h-6 ${isActive ? 'text-white' : 'text-primary'}`} />
                      </button>
                      <span className={`truncate font-bold tracking-wide w-full text-center`} style={{ letterSpacing: 0.5, fontSize: isActive ? 13 : 11, color: '#111' }}>{tab.label}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </div>
      </div>
      {/* Tab Content */}
      <div className="w-full min-h-screen">
        <div key={activeTab} className="p-6 pb-6 md:pb-6 mb-4 md:mb-0 slide-fade-in">
          {tabContent[activeTab]}
        </div>
      </div>
    </div>
  );
};

export default CaseManagerPage; 