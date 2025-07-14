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
  MagnifyingGlassIcon,
  FunnelIcon,
  PlusIcon,
  ChartBarIcon,
  CalendarIcon,
  BellIcon,
  ChatBubbleLeftRightIcon,
  PaperAirplaneIcon,
  ArrowPathIcon,
  InboxArrowDownIcon,
  FolderIcon,
  DocumentArrowUpIcon,
  EyeIcon,
  PencilIcon,
  TrashIcon,
  UserPlusIcon,
  ArrowLeftIcon,
  MapPinIcon,
  CalendarDaysIcon,
  IdentificationIcon,
  HeartIcon,
} from '@heroicons/react/24/outline';
import Tree from 'react-d3-tree';
import { createPortal } from 'react-dom';

const tabs = [
  { id: 'dashboard', label: 'Dashboard', icon: ChartBarIcon },
  { id: 'cases', label: 'Cases', icon: FolderIcon },
  { id: 'documents', label: 'Documents', icon: DocumentTextIcon },
  { id: 'tasks', label: 'Tasks', icon: ClockIcon },
  { id: 'communications', label: 'Communications', icon: ChatBubbleLeftRightIcon },
  { id: 'applications', label: 'Applications', icon: DocumentArrowUpIcon },
  { id: 'clients', label: 'Clients', icon: UserIcon },
] as const;

type TabId = typeof tabs[number]['id'];

// Mock family data for a case
const mockFamilyData = {
  'C-2024-001': {
    caseInfo: {
      id: 'C-2024-001',
      client: 'Sarah Müller',
      country: 'Germany',
      stage: 'Document Review',
      priority: 'High',
      created: '2024-03-15',
      lastUpdate: '2 hours ago',
      progress: 65,
      caseManager: 'Anna Weber',
      targetCountry: 'Germany',
      applicationPath: 'Section 116 - Persecuted Ancestors'
    },
    familyMembers: [
      {
        id: 1,
        name: 'Friedrich Müller',
        relationship: 'Great-grandfather (Persecuted Ancestor)',
        dob: '1895-03-12',
        dod: '1943-11-20',
        birthPlace: 'Berlin, Germany',
        idNumber: 'GER-1895-001',
        isPersecuted: true,
        isMainApplicant: false,
        persecutionDetails: {
          reason: 'Jewish faith and political opposition',
          evidence: 'Deportation records, Yad Vashem testimony, police records',
          dateOfPersecution: '1942-09-15',
          location: 'Berlin, then Auschwitz'
        },
        contactInfo: {
          email: null,
          phone: null,
          address: 'Deceased'
        },
        maritalStatus: 'Married to Rosa Müller (deceased)',
        parentId: null,
        docs: { 
          birth: true, 
          death: true, 
          marriage: true, 
          persecution: true,
          police: false,
          passport: false 
        },
        avatar: 'FM'
      },
      {
        id: 2,
        name: 'Heinrich Müller',
        relationship: 'Grandfather',
        dob: '1920-07-22',
        dod: '1995-12-10',
        birthPlace: 'Berlin, Germany',
        idNumber: 'GER-1920-002',
        isPersecuted: false,
        isMainApplicant: false,
        contactInfo: {
          email: null,
          phone: null,
          address: 'Deceased'
        },
        maritalStatus: 'Married to Ingrid Müller (deceased)',
        parentId: 1,
        docs: { 
          birth: true, 
          death: true, 
          marriage: true, 
          persecution: false,
          police: false,
          passport: false 
        },
        avatar: 'HM'
      },
      {
        id: 3,
        name: 'Klaus Müller',
        relationship: 'Father',
        dob: '1955-04-15',
        dod: null,
        birthPlace: 'Munich, Germany',
        idNumber: 'GER-1955-003',
        isPersecuted: false,
        isMainApplicant: false,
        contactInfo: {
          email: 'klaus.mueller@email.com',
          phone: '+49 89 123 4567',
          address: 'Münchener Str. 45, 80331 Munich, Germany'
        },
        maritalStatus: 'Married to Elisabeth Müller',
        parentId: 2,
        docs: { 
          birth: true, 
          death: false, 
          marriage: true, 
          persecution: false,
          police: true,
          passport: true 
        },
        avatar: 'KM'
      },
      {
        id: 4,
        name: 'Sarah Müller',
        relationship: 'Main Applicant',
        dob: '1985-09-12',
        dod: null,
        birthPlace: 'New York, USA',
        idNumber: 'USA-1985-004',
        isPersecuted: false,
        isMainApplicant: true,
        contactInfo: {
          email: 'sarah.mueller@email.com',
          phone: '+1 212 555 0123',
          address: '123 Manhattan Ave, New York, NY 10001, USA'
        },
        maritalStatus: 'Single',
        parentId: 3,
        docs: { 
          birth: true, 
          death: false, 
          marriage: false, 
          persecution: false,
          police: true,
          passport: true 
        },
        avatar: 'SM'
      },
      {
        id: 5,
        name: 'Michael Müller',
        relationship: 'Brother',
        dob: '1988-02-28',
        dod: null,
        birthPlace: 'New York, USA',
        idNumber: 'USA-1988-005',
        isPersecuted: false,
        isMainApplicant: false,
        contactInfo: {
          email: 'michael.mueller@email.com',
          phone: '+1 212 555 0456',
          address: '456 Brooklyn Ave, New York, NY 10002, USA'
        },
        maritalStatus: 'Married to Lisa Müller',
        parentId: 3,
        docs: { 
          birth: true, 
          death: false, 
          marriage: true, 
          persecution: false,
          police: false,
          passport: true 
        },
        avatar: 'MM'
      }
    ]
  }
};

// Helper to build family tree for visualization
function buildFamilyTree(familyMembers: any[]) {
  const memberMap: Record<number, any> = {};
  familyMembers.forEach(member => {
    memberMap[member.id] = { ...member, children: [] };
  });
  
  const roots: any[] = [];
  familyMembers.forEach(member => {
    if (member.parentId && memberMap[member.parentId]) {
      memberMap[member.parentId].children.push(memberMap[member.id]);
    } else if (!member.parentId) {
      roots.push(memberMap[member.id]);
    }
  });
  
  return roots.length === 1 ? roots[0] : roots;
}

// Custom tree node renderer for family members
const renderFamilyNode = ({ nodeDatum }: any, onNodeClick: (node: any) => void) => (
  <g
    style={{ cursor: 'pointer' }}
    onClick={() => onNodeClick(nodeDatum)}
  >
    {/* Main card background */}
    <rect
      width="280"
      height="160"
      x="-140"
      y="-80"
      rx="20"
      fill="#fff"
      stroke={nodeDatum.isPersecuted ? '#ef4444' : nodeDatum.isMainApplicant ? '#3b82f6' : '#e5e7eb'}
      strokeWidth={nodeDatum.isPersecuted || nodeDatum.isMainApplicant ? "3" : "2"}
      style={{ 
        filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.15))',
        fillOpacity: 0.95
      }}
    />
    
    {/* Content */}
    <foreignObject x="-130" y="-70" width="260" height="140">
      <div style={{
        fontFamily: 'Inter, system-ui, sans-serif',
        padding: '12px',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center'
      }}>
        {/* Name */}
        <div style={{ 
          fontWeight: 700, 
          fontSize: 16, 
          color: '#111', 
          marginBottom: 4,
          textAlign: 'center',
          lineHeight: 1.2
        }}>
          {nodeDatum.name}
        </div>
        
        {/* Relationship */}
        <div style={{ 
          fontWeight: 500, 
          fontSize: 12, 
          color: nodeDatum.isPersecuted ? '#ef4444' : '#6366f1',
          marginBottom: 6,
          textAlign: 'center'
        }}>
          {nodeDatum.relationship}
        </div>
        
        {/* Birth/Death dates */}
        <div style={{ 
          fontSize: 11, 
          color: '#6b7280', 
          marginBottom: 8,
          textAlign: 'center'
        }}>
          {nodeDatum.dob} {nodeDatum.dod && `- ${nodeDatum.dod}`}
        </div>
        
        {/* Badges */}
        <div style={{ 
          display: 'flex', 
          gap: 4, 
          justifyContent: 'center',
          flexWrap: 'wrap'
        }}>
          {nodeDatum.isPersecuted && (
            <span style={{
              background: '#ef4444',
              color: '#fff',
              fontWeight: 600,
              fontSize: 10,
              borderRadius: 12,
              padding: '2px 8px'
            }}>Persecuted</span>
          )}
          {nodeDatum.isMainApplicant && (
            <span style={{
              background: '#3b82f6',
              color: '#fff',
              fontWeight: 600,
              fontSize: 10,
              borderRadius: 12,
              padding: '2px 8px'
            }}>Main Applicant</span>
          )}
          {nodeDatum.dod && (
            <span style={{
              background: '#6b7280',
              color: '#fff',
              fontWeight: 500,
              fontSize: 10,
              borderRadius: 12,
              padding: '2px 8px'
            }}>Deceased</span>
          )}
        </div>
      </div>
    </foreignObject>
  </g>
);

// Comprehensive Case Details Component
const CaseDetailsView = ({ 
  caseData, 
  onBack 
}: { 
  caseData: any; 
  onBack: () => void;
}) => {
  const [activeDetailTab, setActiveDetailTab] = useState('overview');
  const [selectedFamilyMember, setSelectedFamilyMember] = useState<any | null>(null);
  const [dragActive, setDragActive] = useState<Record<number, boolean>>({});
  const [uploadedFiles, setUploadedFiles] = useState<Record<number, any[]>>({});
  
  const familyTree = buildFamilyTree(caseData.familyMembers);
  const persecutedAncestor = caseData.familyMembers.find((m: any) => m.isPersecuted);
  
  const handleNodeClick = (node: any) => {
    setSelectedFamilyMember(node);
  };
  
  const handleDrop = (e: React.DragEvent, memberId: number) => {
    e.preventDefault();
    setDragActive(prev => ({ ...prev, [memberId]: false }));
    const files = Array.from(e.dataTransfer.files);
    setUploadedFiles(prev => ({
      ...prev,
      [memberId]: [...(prev[memberId] || []), ...files]
    }));
  };
  
  const handleDragOver = (e: React.DragEvent, memberId: number) => {
    e.preventDefault();
    setDragActive(prev => ({ ...prev, [memberId]: true }));
  };
  
  const handleDragLeave = (e: React.DragEvent, memberId: number) => {
    e.preventDefault();
    setDragActive(prev => ({ ...prev, [memberId]: false }));
  };

  const detailTabs = [
    { id: 'overview', label: 'Overview', icon: ChartBarIcon },
    { id: 'family', label: 'Family Tree', icon: UserIcon },
    { id: 'contacts', label: 'Contacts', icon: PhoneIcon },
    { id: 'documents', label: 'Documents', icon: DocumentTextIcon },
    { id: 'tasks', label: 'Tasks', icon: ClockIcon },
    { id: 'timeline', label: 'Timeline', icon: CalendarIcon },
  ];
  
  return (
    <div className="space-y-6">
      {/* Header with Back Button */}
      <div className="bg-white rounded-3xl p-6 shadow-lg border border-gray-200">
        <div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button 
                onClick={onBack}
                className="btn btn-outline btn-sm gap-2"
              >
                <ArrowLeftIcon className="w-4 h-4" />
                Back to Cases
              </button>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">{caseData.caseInfo.id} - {caseData.caseInfo.client}</h1>
                <p className="text-gray-600">{caseData.caseInfo.applicationPath}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className={`badge ${
                caseData.caseInfo.priority === 'High' ? 'badge-error' : 
                caseData.caseInfo.priority === 'Medium' ? 'badge-warning' : 'badge-info'
              } badge-lg`}>
                {caseData.caseInfo.priority} Priority
              </span>
              <span className="badge badge-primary badge-lg">{caseData.caseInfo.stage}</span>
            </div>
          </div>
          
          {/* Quick Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">{caseData.familyMembers.length}</div>
              <div className="text-sm text-gray-600">Family Members</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-red-600">
                {caseData.familyMembers.filter((m: any) => m.isPersecuted).length}
              </div>
              <div className="text-sm text-gray-600">Persecuted Ancestors</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">{caseData.caseInfo.progress}%</div>
              <div className="text-sm text-gray-600">Progress</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-600">
                {caseData.familyMembers.reduce((acc: number, m: any) => 
                  acc + Object.values(m.docs).filter(Boolean).length, 0
                )}
              </div>
              <div className="text-sm text-gray-600">Documents Collected</div>
            </div>
          </div>
        </div>
      </div>
      
      {/* Detail Tabs */}
      <div className="bg-white rounded-2xl p-6 shadow-lg border border-gray-200">
        <div className="p-2">
          <div className="flex gap-2 overflow-x-auto">
            {detailTabs.map((tab) => (
              <button
                key={tab.id}
                className={`flex items-center gap-2 px-4 py-3 rounded-xl font-semibold transition-all duration-300 whitespace-nowrap ${
                  activeDetailTab === tab.id 
                    ? 'bg-blue-600 text-white shadow-lg' 
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
                onClick={() => setActiveDetailTab(tab.id)}
              >
                <tab.icon className="w-5 h-5" />
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      
      {/* Tab Content */}
      <div className="animate-fade-in">
        {activeDetailTab === 'overview' && (
          <div className="space-y-6">
            {/* Case Information */}
            <div className="bg-white rounded-3xl p-6 shadow-lg border border-gray-200">
              <div>
                <h3 className="text-xl font-bold mb-4">Case Information</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div>
                    <span className="text-sm text-gray-600">Target Country:</span>
                    <div className="font-semibold">{caseData.caseInfo.targetCountry}</div>
                  </div>
                  <div>
                    <span className="text-sm text-gray-600">Application Path:</span>
                    <div className="font-semibold">{caseData.caseInfo.applicationPath}</div>
                  </div>
                  <div>
                    <span className="text-sm text-gray-600">Case Manager:</span>
                    <div className="font-semibold">{caseData.caseInfo.caseManager}</div>
                  </div>
                  <div>
                    <span className="text-sm text-gray-600">Created:</span>
                    <div className="font-semibold">{caseData.caseInfo.created}</div>
                  </div>
                  <div>
                    <span className="text-sm text-gray-600">Last Update:</span>
                    <div className="font-semibold">{caseData.caseInfo.lastUpdate}</div>
                  </div>
                  <div>
                    <span className="text-sm text-gray-600">Current Stage:</span>
                    <div className="font-semibold text-blue-600">{caseData.caseInfo.stage}</div>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Persecuted Ancestor Details */}
            {persecutedAncestor && (
              <div className="bg-white rounded-3xl p-6 shadow-lg border border-gray-200">
                <div>
                  <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                    <HeartIcon className="w-6 h-6 text-red-500" />
                    Persecuted Ancestor: {persecutedAncestor.name}
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-3">
                      <div>
                        <span className="text-sm text-gray-600">Birth - Death:</span>
                        <div className="font-semibold">{persecutedAncestor.dob} - {persecutedAncestor.dod}</div>
                      </div>
                      <div>
                        <span className="text-sm text-gray-600">Birth Place:</span>
                        <div className="font-semibold">{persecutedAncestor.birthPlace}</div>
                      </div>
                      <div>
                        <span className="text-sm text-gray-600">Reason for Persecution:</span>
                        <div className="font-semibold text-red-600">{persecutedAncestor.persecutionDetails.reason}</div>
                      </div>
                    </div>
                    <div className="space-y-3">
                      <div>
                        <span className="text-sm text-gray-600">Date of Persecution:</span>
                        <div className="font-semibold">{persecutedAncestor.persecutionDetails.dateOfPersecution}</div>
                      </div>
                      <div>
                        <span className="text-sm text-gray-600">Location:</span>
                        <div className="font-semibold">{persecutedAncestor.persecutionDetails.location}</div>
                      </div>
                      <div>
                        <span className="text-sm text-gray-600">Evidence Available:</span>
                        <div className="font-semibold text-green-600">{persecutedAncestor.persecutionDetails.evidence}</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
        
        {activeDetailTab === 'family' && (
          <div className="space-y-6">
            {/* Family Tree Visualization */}
            <div className="bg-white rounded-3xl p-6 shadow-lg border border-gray-200">
              <div>
                <h3 className="text-xl font-bold mb-6">Family Tree - Lineage from Persecuted Ancestor</h3>
                <div style={{ width: '100%', height: '600px' }}>
                  <Tree
                    data={familyTree}
                    orientation="vertical"
                    translate={{ x: 400, y: 100 }}
                    renderCustomNodeElement={(rd) => renderFamilyNode(rd, handleNodeClick)}
                    pathFunc="elbow"
                    zoomable={true}
                    collapsible={false}
                    separation={{ siblings: 1.5, nonSiblings: 2 }}
                    nodeSize={{ x: 300, y: 200 }}
                  />
                </div>
                <div className="mt-4 flex gap-4 text-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 bg-red-500 rounded"></div>
                    <span>Persecuted Ancestor</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 bg-blue-500 rounded"></div>
                    <span>Main Applicant</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 bg-gray-400 rounded"></div>
                    <span>Deceased</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeDetailTab === 'contacts' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {caseData.familyMembers.map((member: any) => (
                <div key={member.id} className="bg-white rounded-3xl p-6 shadow-lg border border-gray-200">
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-bold">{member.name}</h3>
                      <div className="flex gap-2">
                        {member.isPersecuted && <span className="badge badge-error badge-sm">Persecuted</span>}
                        {member.isMainApplicant && <span className="badge badge-primary badge-sm">Main</span>}
                        {member.dod && <span className="badge badge-neutral badge-sm">Deceased</span>}
                      </div>
                    </div>
                    <p className="text-sm text-gray-600 mb-4">{member.relationship}</p>
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <EnvelopeIcon className="w-4 h-4 text-gray-500" />
                        <span className="text-sm">{member.contactInfo.email || 'N/A'}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <PhoneIcon className="w-4 h-4 text-gray-500" />
                        <span className="text-sm">{member.contactInfo.phone || 'N/A'}</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <MapPinIcon className="w-4 h-4 text-gray-500 mt-0.5" />
                        <span className="text-sm">{member.contactInfo.address || 'N/A'}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <CalendarDaysIcon className="w-4 h-4 text-gray-500" />
                        <span className="text-sm">{member.dob} - {member.birthPlace}</span>
                      </div>
                    </div>
                    <div className="mt-4 flex gap-2">
                      <button className="btn btn-sm btn-outline">Edit</button>
                      {member.contactInfo.email && member.contactInfo.email !== 'N/A' && (
                        <button className="btn btn-sm btn-primary">Email</button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeDetailTab === 'documents' && (
          <div className="space-y-6">
            {caseData.familyMembers.map((member: any) => (
              <div key={member.id} className="bg-white rounded-3xl p-6 shadow-lg border border-gray-200">
                <div>
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-lg font-bold">{member.name} - Documents</h3>
                    <div className="flex gap-2">
                      {member.isPersecuted && <span className="badge badge-error">Persecuted</span>}
                      {member.isMainApplicant && <span className="badge badge-primary">Main Applicant</span>}
                    </div>
                  </div>
                  
                  {/* Document Status Grid */}
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
                    {Object.entries(member.docs).map(([docType, hasDoc]: [string, any]) => (
                      <div key={docType} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <span className="capitalize text-sm font-medium">{docType}</span>
                        <span className={`badge badge-sm ${hasDoc ? 'badge-success' : 'badge-error'}`}>
                          {hasDoc ? '✓' : '✗'}
                        </span>
                      </div>
                    ))}
                  </div>
                  
                  {/* Drag and Drop Upload */}
                  <div
                    className={`border-2 border-dashed rounded-lg p-6 text-center transition-all duration-200 ${
                      dragActive[member.id] ? 'border-blue-500 bg-blue-50' : 'border-gray-300'
                    }`}
                    onDragOver={(e) => handleDragOver(e, member.id)}
                    onDragLeave={(e) => handleDragLeave(e, member.id)}
                    onDrop={(e) => handleDrop(e, member.id)}
                  >
                    <DocumentArrowUpIcon className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                    <p className="text-sm text-gray-600 mb-2">Drag and drop documents for {member.name}</p>
                    <p className="text-xs text-gray-500">or click to browse</p>
                    <input type="file" multiple className="hidden" />
                    <button className="btn btn-outline btn-sm mt-3">Choose Files</button>
                  </div>
                  
                  {/* Uploaded Files */}
                  {uploadedFiles[member.id] && uploadedFiles[member.id].length > 0 && (
                    <div className="mt-4">
                      <h4 className="font-semibold mb-2">Uploaded Files:</h4>
                      <div className="space-y-2">
                        {uploadedFiles[member.id].map((file: any, idx: number) => (
                          <div key={idx} className="flex items-center justify-between p-2 bg-green-50 rounded">
                            <span className="text-sm font-medium">{file.name}</span>
                            <span className="badge badge-success badge-sm">New</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {activeDetailTab === 'tasks' && (
          <div className="space-y-6">
            {/* Task Summary */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {[
                { label: 'Total Tasks', count: 12, color: 'bg-blue-500' },
                { label: 'In Progress', count: 5, color: 'bg-yellow-500' },
                { label: 'Completed', count: 6, color: 'bg-green-500' },
                { label: 'Overdue', count: 1, color: 'bg-red-500' },
              ].map((stat, idx) => (
                <div key={idx} className="text-center p-4 bg-white rounded-2xl shadow border">
                  <div className={`w-12 h-12 ${stat.color} rounded-full flex items-center justify-center mx-auto mb-2`}>
                    <span className="text-xl font-bold text-white">{stat.count}</span>
                  </div>
                  <div className="text-sm font-semibold text-gray-700">{stat.label}</div>
                </div>
              ))}
            </div>

            {/* Case Tasks */}
            <div className="bg-white rounded-3xl p-6 shadow-lg border border-gray-200">
              <div>
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-xl font-bold">Case Tasks</h3>
                  <button className="btn btn-primary gap-2">
                    <PlusIcon className="w-4 h-4" />
                    Add Task
                  </button>
                </div>
                <div className="space-y-4">
                  {[
                    { id: 1, title: 'Request birth certificate from Friedrich Müller archives', assignee: 'Sarah Müller', dueDate: '2024-07-15', priority: 'High', status: 'In Progress', familyMember: 'Friedrich Müller' },
                    { id: 2, title: 'Translate Heinrich Müller death certificate', assignee: 'Case Manager', dueDate: '2024-07-18', priority: 'Medium', status: 'Pending', familyMember: 'Heinrich Müller' },
                    { id: 3, title: 'Obtain police certificate for Klaus Müller', assignee: 'Klaus Müller', dueDate: '2024-07-20', priority: 'High', status: 'In Progress', familyMember: 'Klaus Müller' },
                    { id: 4, title: 'Schedule consultation with persecution expert', assignee: 'Case Manager', dueDate: '2024-07-12', priority: 'High', status: 'Overdue', familyMember: 'All' },
                    { id: 5, title: 'Review Sarah\'s educational documents', assignee: 'Case Manager', dueDate: '2024-07-25', priority: 'Low', status: 'Pending', familyMember: 'Sarah Müller' },
                    { id: 6, title: 'Submit preliminary application to German consulate', assignee: 'Case Manager', dueDate: '2024-08-01', priority: 'High', status: 'Pending', familyMember: 'All' },
                  ].map((task) => (
                    <div key={task.id} className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition-colors">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <input type="checkbox" className="checkbox checkbox-primary" />
                            <h4 className="font-semibold text-gray-900">{task.title}</h4>
                            <span className={`badge badge-sm ${
                              task.priority === 'High' ? 'badge-error' :
                              task.priority === 'Medium' ? 'badge-warning' : 'badge-info'
                            }`}>
                              {task.priority}
                            </span>
                          </div>
                          <div className="flex items-center gap-4 text-sm text-gray-600">
                            <span>Assignee: {task.assignee}</span>
                            <span>Due: {task.dueDate}</span>
                            <span>Family: {task.familyMember}</span>
                          </div>
                          <div className="mt-2">
                            <span className={`badge ${
                              task.status === 'Completed' ? 'badge-success' :
                              task.status === 'In Progress' ? 'badge-warning' :
                              task.status === 'Overdue' ? 'badge-error' : 'badge-info'
                            }`}>
                              {task.status}
                            </span>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button className="btn btn-xs btn-outline">Edit</button>
                          <button className="btn btn-xs btn-primary">View</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeDetailTab === 'timeline' && (
          <div className="space-y-6">
            <div className="bg-white rounded-3xl p-6 shadow-lg border border-gray-200">
              <div>
                <h3 className="text-xl font-bold mb-6">Case Timeline</h3>
                <div className="relative">
                  {/* Timeline line */}
                  <div className="absolute left-8 top-0 bottom-0 w-0.5 bg-gray-300"></div>
                  
                  <div className="space-y-8">
                    {[
                      { date: '2024-07-10', time: '14:30', title: 'Friedrich Müller persecution evidence verified', description: 'Historical documents confirmed with Yad Vashem database', type: 'success', icon: '✓' },
                      { date: '2024-07-09', time: '10:15', title: 'Sarah Müller police certificate uploaded', description: 'Clean criminal record certificate from NYC authorities', type: 'success', icon: '📄' },
                      { date: '2024-07-08', time: '16:45', title: 'Family tree structure confirmed', description: 'All family relationships verified and documented', type: 'info', icon: '👥' },
                      { date: '2024-07-05', time: '09:00', title: 'Initial consultation completed', description: 'Case eligibility confirmed under Section 116', type: 'info', icon: '💬' },
                      { date: '2024-07-01', time: '11:30', title: 'Heinrich Müller death certificate received', description: 'Official document obtained from Berlin civil registry', type: 'success', icon: '📋' },
                      { date: '2024-06-28', time: '15:20', title: 'Klaus Müller contact information updated', description: 'Current address and phone number verified', type: 'info', icon: '📞' },
                      { date: '2024-06-15', time: '13:00', title: 'Case opened', description: 'Initial application for German citizenship by descent', type: 'info', icon: '🏁' },
                    ].map((event, idx) => (
                      <div key={idx} className="relative flex items-start gap-4">
                        {/* Timeline dot */}
                        <div className={`flex items-center justify-center w-16 h-16 rounded-full border-4 border-white shadow-lg ${
                          event.type === 'success' ? 'bg-green-500' :
                          event.type === 'warning' ? 'bg-yellow-500' :
                          event.type === 'error' ? 'bg-red-500' : 'bg-blue-500'
                        }`}>
                          <span className="text-2xl">{event.icon}</span>
                        </div>
                        
                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="bg-gray-50 rounded-lg p-4">
                            <div className="flex items-center justify-between mb-2">
                              <h4 className="font-semibold text-gray-900">{event.title}</h4>
                              <div className="text-sm text-gray-500">
                                {event.date} at {event.time}
                              </div>
                            </div>
                            <p className="text-gray-700">{event.description}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      
      {/* Family Member Details Modal */}
      {selectedFamilyMember && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/30" onClick={() => setSelectedFamilyMember(null)} />
          <div className="bg-white rounded-2xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto z-50 shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-2xl font-bold">{selectedFamilyMember.name}</h3>
              <button 
                onClick={() => setSelectedFamilyMember(null)}
                className="btn btn-ghost btn-circle"
              >
                <XCircleIcon className="w-6 h-6" />
              </button>
            </div>
            
            <div className="space-y-6">
              {/* Basic Info */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-sm text-gray-600">Relationship:</span>
                  <div className="font-semibold">{selectedFamilyMember.relationship}</div>
                </div>
                <div>
                  <span className="text-sm text-gray-600">Birth Date:</span>
                  <div className="font-semibold">{selectedFamilyMember.dob}</div>
                </div>
                <div>
                  <span className="text-sm text-gray-600">Birth Place:</span>
                  <div className="font-semibold">{selectedFamilyMember.birthPlace}</div>
                </div>
                <div>
                  <span className="text-sm text-gray-600">ID Number:</span>
                  <div className="font-semibold">{selectedFamilyMember.idNumber}</div>
                </div>
              </div>
              
              {/* Contact Info */}
              <div>
                <h4 className="font-semibold mb-3">Contact Information</h4>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <EnvelopeIcon className="w-4 h-4 text-gray-500" />
                    <span>{selectedFamilyMember.contactInfo.email || 'N/A'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <PhoneIcon className="w-4 h-4 text-gray-500" />
                    <span>{selectedFamilyMember.contactInfo.phone || 'N/A'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <MapPinIcon className="w-4 h-4 text-gray-500" />
                    <span>{selectedFamilyMember.contactInfo.address || 'N/A'}</span>
                  </div>
                </div>
              </div>
              
              {/* Persecution Details */}
              {selectedFamilyMember.isPersecuted && selectedFamilyMember.persecutionDetails && (
                <div>
                  <h4 className="font-semibold mb-3 text-red-600">Persecution Details</h4>
                  <div className="space-y-2 p-4 bg-red-50 rounded-lg">
                    <div>
                      <span className="text-sm text-gray-600">Reason:</span>
                      <div className="font-semibold">{selectedFamilyMember.persecutionDetails.reason}</div>
                    </div>
                    <div>
                      <span className="text-sm text-gray-600">Date:</span>
                      <div className="font-semibold">{selectedFamilyMember.persecutionDetails.dateOfPersecution}</div>
                    </div>
                    <div>
                      <span className="text-sm text-gray-600">Location:</span>
                      <div className="font-semibold">{selectedFamilyMember.persecutionDetails.location}</div>
                    </div>
                    <div>
                      <span className="text-sm text-gray-600">Evidence:</span>
                      <div className="font-semibold">{selectedFamilyMember.persecutionDetails.evidence}</div>
                    </div>
                  </div>
                </div>
              )}
              
              {/* Documents */}
              <div>
                <h4 className="font-semibold mb-3">Documents Status</h4>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(selectedFamilyMember.docs).map(([docType, hasDoc]: [string, any]) => (
                    <div key={docType} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                      <span className="capitalize">{docType}</span>
                      <span className={`badge badge-sm ${hasDoc ? 'badge-success' : 'badge-error'}`}>
                        {hasDoc ? 'Available' : 'Missing'}
                      </span>
                    </div>
                  ))}
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

// Case Manager Dashboard with gradient boxes
const DashboardContent = () => {
  return (
    <div className="space-y-8">
      {/* Summary Cards with Gradients */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
        {/* Active Cases */}
        <div className="rounded-2xl cursor-pointer transition-all duration-300 hover:scale-[1.03] hover:shadow-2xl shadow-xl bg-blue-600 text-white relative overflow-hidden p-4 md:p-6">
          <div className="flex items-center gap-2 md:gap-4">
            <div className="flex items-center justify-center w-10 h-10 md:w-14 md:h-14 rounded-full bg-white/20 shadow">
              <FolderIcon className="w-5 h-5 md:w-7 md:h-7 text-white opacity-90" />
            </div>
            <div>
              <div className="text-2xl md:text-4xl font-extrabold text-white leading-tight">24</div>
              <div className="text-white/80 text-xs md:text-sm font-medium mt-1">Active Cases</div>
            </div>
          </div>
        </div>

        {/* Pending Documents */}
        <div className="rounded-2xl cursor-pointer transition-all duration-300 hover:scale-[1.03] hover:shadow-2xl shadow-xl bg-blue-600 text-white relative overflow-hidden p-4 md:p-6">
          <div className="flex items-center gap-2 md:gap-4">
            <div className="flex items-center justify-center w-10 h-10 md:w-14 md:h-14 rounded-full bg-white/20 shadow">
              <InboxArrowDownIcon className="w-5 h-5 md:w-7 md:h-7 text-white opacity-90" />
            </div>
            <div>
              <div className="text-2xl md:text-4xl font-extrabold text-white leading-tight">12</div>
              <div className="text-white/80 text-xs md:text-sm font-medium mt-1">Pending Docs</div>
            </div>
          </div>
        </div>

        {/* Urgent Tasks */}
        <div className="rounded-2xl cursor-pointer transition-all duration-300 hover:scale-[1.03] hover:shadow-2xl shadow-xl bg-blue-600 text-white relative overflow-hidden p-4 md:p-6">
          <div className="flex items-center gap-2 md:gap-4">
            <div className="flex items-center justify-center w-10 h-10 md:w-14 md:h-14 rounded-full bg-white/20 shadow">
              <ExclamationTriangleIcon className="w-5 h-5 md:w-7 md:h-7 text-white opacity-90" />
            </div>
            <div>
              <div className="text-2xl md:text-4xl font-extrabold text-white leading-tight">7</div>
              <div className="text-white/80 text-xs md:text-sm font-medium mt-1">Urgent Tasks</div>
            </div>
          </div>
        </div>

        {/* Ready to Submit */}
        <div className="rounded-2xl cursor-pointer transition-all duration-300 hover:scale-[1.03] hover:shadow-2xl shadow-xl bg-blue-600 text-white relative overflow-hidden p-4 md:p-6">
          <div className="flex items-center gap-2 md:gap-4">
            <div className="flex items-center justify-center w-10 h-10 md:w-14 md:h-14 rounded-full bg-white/20 shadow">
              <DocumentArrowUpIcon className="w-5 h-5 md:w-7 md:h-7 text-white opacity-90" />
            </div>
            <div>
              <div className="text-2xl md:text-4xl font-extrabold text-white leading-tight">5</div>
              <div className="text-white/80 text-xs md:text-sm font-medium mt-1">Ready to Submit</div>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Search Bar */}
      <div className="w-full">
        <div className="relative max-w-2xl mx-auto">
          <MagnifyingGlassIcon className="absolute left-4 top-1/2 transform -translate-y-1/2 w-6 h-6 text-gray-400" />
          <input
            type="text"
            placeholder="Search cases, clients, or documents..."
            className="input input-bordered w-full pl-12 pr-4 py-4 text-lg rounded-2xl shadow-lg border-2 border-gray-200 focus:border-primary focus:shadow-xl transition-all"
          />
          <button className="absolute right-2 top-1/2 transform -translate-y-1/2 btn btn-primary btn-sm rounded-xl">
            Search
          </button>
        </div>
      </div>

      {/* Recent Activity & Urgent Items */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Recent Activity */}
        <div className="bg-white rounded-3xl p-6 shadow-lg border border-gray-200">
          <div>
            <div className="flex items-center gap-3 mb-6">
              <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-blue-600 shadow">
                <ClockIcon className="w-6 h-6 text-white" />
              </div>
              <span className="text-xl font-bold text-gray-900">Recent Activity</span>
            </div>
            <div className="space-y-4">
              {[
                { client: 'Maria Schmidt', action: 'Documents received', time: '10 min ago', type: 'success' },
                { client: 'Hans Weber', action: 'Application submitted to Germany', time: '1 hour ago', type: 'info' },
                { client: 'Anna Müller', action: 'Missing birth certificate', time: '2 hours ago', type: 'warning' },
                { client: 'Klaus Fischer', action: 'Meeting scheduled', time: '3 hours ago', type: 'info' },
              ].map((activity, idx) => (
                <div key={idx} className="flex items-center gap-4 p-3 hover:bg-gray-50 rounded-lg transition-colors">
                  <div className={`w-3 h-3 rounded-full ${
                    activity.type === 'success' ? 'bg-green-500' :
                    activity.type === 'warning' ? 'bg-yellow-500' : 'bg-blue-500'
                  }`}></div>
                  <div className="flex-1">
                    <div className="font-semibold text-gray-900">{activity.client}</div>
                    <div className="text-sm text-gray-600">{activity.action}</div>
                  </div>
                  <div className="text-xs text-gray-500">{activity.time}</div>
                </div>
              ))}
            </div>
            <div className="text-center mt-6">
              <button className="btn btn-outline btn-primary">View All Activity</button>
            </div>
          </div>
        </div>

        {/* Urgent Items */}
        <div className="bg-white rounded-3xl p-6 shadow-lg border border-gray-200">
          <div>
            <div className="flex items-center gap-3 mb-6">
              <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-blue-600 shadow">
                <ExclamationTriangleIcon className="w-6 h-6 text-white" />
              </div>
              <span className="text-xl font-bold text-gray-900">Urgent Items</span>
            </div>
            <div className="space-y-4">
              {[
                { title: 'Birth Certificate Due', client: 'Sarah Müller', due: 'Today', priority: 'high' },
                { title: 'Police Certificate Expiring', client: 'Michael Weber', due: 'Tomorrow', priority: 'high' },
                { title: 'Application Review', client: 'Lisa Schmidt', due: '2 days', priority: 'medium' },
                { title: 'Client Meeting Prep', client: 'Thomas Koch', due: '3 days', priority: 'medium' },
              ].map((item, idx) => (
                <div key={idx} className="flex items-center justify-between p-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                  <div className="flex-1">
                    <div className="font-semibold text-gray-900">{item.title}</div>
                    <div className="text-sm text-gray-600">{item.client}</div>
                  </div>
                  <div className="text-right">
                    <div className={`text-sm font-bold ${item.priority === 'high' ? 'text-red-600' : 'text-orange-600'}`}>
                      Due: {item.due}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="text-center mt-6">
              <button className="btn btn-error">Manage Urgent Items</button>
            </div>
          </div>
        </div>
      </div>

      {/* Application Status Overview */}
      <div className="bg-white rounded-3xl p-6 shadow-lg border border-gray-200">
        <div>
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-blue-600 shadow">
                <ChartBarIcon className="w-6 h-6 text-white" />
              </div>
              <span className="text-xl font-bold text-gray-900">Application Status Overview</span>
            </div>
            <button className="btn btn-outline btn-sm">View Details</button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {[
              { stage: 'Documents Gathering', count: 8, color: 'bg-blue-500' },
              { stage: 'Documents Review', count: 5, color: 'bg-yellow-500' },
              { stage: 'Application Prep', count: 3, color: 'bg-orange-500' },
              { stage: 'Submitted', count: 6, color: 'bg-green-500' },
              { stage: 'Approved', count: 2, color: 'bg-purple-500' },
            ].map((stage, idx) => (
              <div key={idx} className="text-center p-4 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors">
                <div className={`w-16 h-16 ${stage.color} rounded-full flex items-center justify-center mx-auto mb-3`}>
                  <span className="text-2xl font-bold text-white">{stage.count}</span>
                </div>
                <div className="text-sm font-semibold text-gray-700">{stage.stage}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// Cases Management Tab
const CasesContent = ({ onViewCase }: { onViewCase: (caseId: string) => void }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  
  const mockCases = [
    { id: 'C-2024-001', client: 'Sarah Müller', country: 'Germany', stage: 'Document Review', priority: 'High', lastUpdate: '2 hours ago', progress: 65 },
    { id: 'C-2024-002', client: 'Michael Weber', country: 'Austria', stage: 'Application Prep', priority: 'Medium', lastUpdate: '1 day ago', progress: 80 },
    { id: 'C-2024-003', client: 'Anna Schmidt', country: 'Germany', stage: 'Documents Gathering', priority: 'Low', lastUpdate: '3 days ago', progress: 30 },
    { id: 'C-2024-004', client: 'Klaus Fischer', country: 'Austria', stage: 'Submitted', priority: 'High', lastUpdate: '5 days ago', progress: 90 },
  ];

  return (
    <div className="space-y-6">
      {/* Search and Filters */}
      <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="relative flex-1 max-w-md">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search cases..."
            className="input input-bordered w-full pl-10"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <select className="select select-bordered" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="all">All Cases</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="urgent">Urgent</option>
          </select>
          <button className="btn btn-primary gap-2">
            <PlusIcon className="w-4 h-4" />
            New Case
          </button>
        </div>
      </div>

      {/* Cases Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
        {mockCases.map((case_) => (
          <div key={case_.id} className="bg-white rounded-2xl p-6 shadow-lg border border-gray-200">
            <div className="h-full">
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm font-bold text-primary">{case_.id}</span>
                <span className={`badge ${case_.priority === 'High' ? 'badge-error' : case_.priority === 'Medium' ? 'badge-warning' : 'badge-info'}`}>
                  {case_.priority}
                </span>
              </div>
              <h3 className="text-lg font-bold text-gray-900 mb-2">{case_.client}</h3>
              <div className="space-y-2 mb-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">Country:</span>
                  <span className="text-sm font-semibold">{case_.country}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">Stage:</span>
                  <span className="text-sm font-semibold text-blue-600">{case_.stage}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">Last Update:</span>
                  <span className="text-sm">{case_.lastUpdate}</span>
                </div>
              </div>
              <div className="mb-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-gray-600">Progress</span>
                  <span className="text-xs font-bold">{case_.progress}%</span>
                </div>
                <progress className="progress progress-primary w-full" value={case_.progress} max="100"></progress>
              </div>
              <div className="flex gap-2">
                <button 
                  className="btn btn-sm btn-primary flex-1"
                  onClick={() => onViewCase(case_.id)}
                >
                  View
                </button>
                <button className="btn btn-sm btn-outline">Edit</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// Documents Management Tab
const DocumentsContent = () => {
  const [selectedCategory, setSelectedCategory] = useState('all');
  
  const mockDocuments = [
    { id: 1, name: 'Birth Certificate - Sarah Müller', type: 'Birth Certificate', client: 'Sarah Müller', status: 'Received', uploadDate: '2024-07-10', expiry: '2025-07-10' },
    { id: 2, name: 'Police Certificate - Michael Weber', type: 'Police Certificate', client: 'Michael Weber', status: 'Pending', uploadDate: '2024-07-08', expiry: '2024-12-08' },
    { id: 3, name: 'Marriage Certificate - Anna Schmidt', type: 'Marriage Certificate', client: 'Anna Schmidt', status: 'Missing', uploadDate: null, expiry: null },
    { id: 4, name: 'Passport Copy - Klaus Fischer', type: 'Identity Document', client: 'Klaus Fischer', status: 'Received', uploadDate: '2024-07-05', expiry: '2026-03-15' },
  ];

  return (
    <div className="space-y-6">
      {/* Document Categories and Upload */}
      <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="flex gap-2 flex-wrap">
          {['all', 'Birth Certificate', 'Police Certificate', 'Marriage Certificate', 'Identity Document'].map((category) => (
            <button
              key={category}
              className={`btn btn-sm ${selectedCategory === category ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setSelectedCategory(category)}
            >
              {category.charAt(0).toUpperCase() + category.slice(1)}
            </button>
          ))}
        </div>
        <button className="btn btn-primary gap-2">
          <DocumentArrowUpIcon className="w-4 h-4" />
          Upload Document
        </button>
      </div>

      {/* Documents Table */}
      <div className="bg-white rounded-2xl p-6 shadow-lg border border-gray-200">
        <div>
          <div className="overflow-x-auto">
            <table className="table w-full">
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Client</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Upload Date</th>
                  <th>Expiry</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {mockDocuments.map((doc) => (
                  <tr key={doc.id} className="hover:bg-gray-50">
                    <td className="font-semibold">{doc.name}</td>
                    <td>{doc.client}</td>
                    <td>
                      <span className="badge badge-outline">{doc.type}</span>
                    </td>
                    <td>
                      <span className={`badge ${
                        doc.status === 'Received' ? 'badge-success' :
                        doc.status === 'Pending' ? 'badge-warning' : 'badge-error'
                      }`}>
                        {doc.status}
                      </span>
                    </td>
                    <td>{doc.uploadDate || 'N/A'}</td>
                    <td>{doc.expiry || 'N/A'}</td>
                    <td>
                      <div className="flex gap-1">
                        <button className="btn btn-xs btn-outline">
                          <EyeIcon className="w-3 h-3" />
                        </button>
                        <button className="btn btn-xs btn-outline">
                          <PencilIcon className="w-3 h-3" />
                        </button>
                        <button className="btn btn-xs btn-outline btn-error">
                          <TrashIcon className="w-3 h-3" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

// Tasks Management Tab
const TasksContent = () => {
  const mockTasks = [
    { id: 1, title: 'Review birth certificate for Sarah Müller', client: 'Sarah Müller', dueDate: '2024-07-12', priority: 'High', status: 'In Progress' },
    { id: 2, title: 'Request police certificate from Michael Weber', client: 'Michael Weber', dueDate: '2024-07-15', priority: 'Medium', status: 'Pending' },
    { id: 3, title: 'Schedule consultation with Anna Schmidt', client: 'Anna Schmidt', dueDate: '2024-07-18', priority: 'Low', status: 'Completed' },
    { id: 4, title: 'Submit application for Klaus Fischer', client: 'Klaus Fischer', dueDate: '2024-07-20', priority: 'High', status: 'Pending' },
  ];

  return (
    <div className="space-y-6">
      {/* Task Controls */}
      <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="flex gap-2">
          <button className="btn btn-primary gap-2">
            <PlusIcon className="w-4 h-4" />
            New Task
          </button>
          <button className="btn btn-outline gap-2">
            <CalendarIcon className="w-4 h-4" />
            Calendar View
          </button>
        </div>
        <div className="flex gap-2">
          <select className="select select-bordered">
            <option>All Tasks</option>
            <option>High Priority</option>
            <option>Due Today</option>
            <option>Overdue</option>
          </select>
        </div>
      </div>

      {/* Tasks List */}
      <div className="space-y-4">
        {mockTasks.map((task) => (
          <div key={task.id} className="bg-white rounded-2xl p-6 shadow-lg border border-gray-200">
            <div>
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <input type="checkbox" className="checkbox checkbox-primary" />
                    <h3 className="text-lg font-semibold text-gray-900">{task.title}</h3>
                    <span className={`badge ${
                      task.priority === 'High' ? 'badge-error' :
                      task.priority === 'Medium' ? 'badge-warning' : 'badge-info'
                    }`}>
                      {task.priority}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-gray-600">
                    <span>Client: {task.client}</span>
                    <span>Due: {task.dueDate}</span>
                    <span className={`font-semibold ${
                      task.status === 'Completed' ? 'text-green-600' :
                      task.status === 'In Progress' ? 'text-blue-600' : 'text-gray-600'
                    }`}>
                      {task.status}
                    </span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button className="btn btn-sm btn-outline">Edit</button>
                  <button className="btn btn-sm btn-primary">View</button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// Communications Tab
const CommunicationsContent = () => {
  const [selectedTab, setSelectedTab] = useState('messages');
  
  const mockMessages = [
    { id: 1, from: 'Sarah Müller', subject: 'Documents uploaded', time: '2 hours ago', status: 'unread' },
    { id: 2, from: 'Michael Weber', subject: 'Question about application', time: '1 day ago', status: 'read' },
    { id: 3, from: 'Anna Schmidt', subject: 'Meeting confirmation', time: '2 days ago', status: 'replied' },
  ];

  return (
    <div className="space-y-6">
      {/* Communication Tabs */}
      <div className="tabs tabs-lifted">
        <button 
          className={`tab ${selectedTab === 'messages' ? 'tab-active' : ''}`}
          onClick={() => setSelectedTab('messages')}
        >
          Messages
        </button>
        <button 
          className={`tab ${selectedTab === 'emails' ? 'tab-active' : ''}`}
          onClick={() => setSelectedTab('emails')}
        >
          Email Templates
        </button>
        <button 
          className={`tab ${selectedTab === 'reminders' ? 'tab-active' : ''}`}
          onClick={() => setSelectedTab('reminders')}
        >
          Reminders
        </button>
      </div>

      {selectedTab === 'messages' && (
        <div className="bg-white rounded-2xl p-6 shadow-lg border border-gray-200">
          <div>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold">Client Messages</h3>
              <button className="btn btn-primary gap-2">
                <PaperAirplaneIcon className="w-4 h-4" />
                Compose
              </button>
            </div>
            <div className="space-y-4">
              {mockMessages.map((message) => (
                <div key={message.id} className="flex items-center gap-4 p-4 border border-gray-200 rounded-lg hover:bg-gray-50">
                  <div className={`w-3 h-3 rounded-full ${
                    message.status === 'unread' ? 'bg-blue-500' :
                    message.status === 'replied' ? 'bg-green-500' : 'bg-gray-300'
                  }`}></div>
                  <div className="flex-1">
                    <div className="font-semibold text-gray-900">{message.from}</div>
                    <div className="text-sm text-gray-600">{message.subject}</div>
                  </div>
                  <div className="text-sm text-gray-500">{message.time}</div>
                  <button className="btn btn-sm btn-outline">Reply</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {selectedTab === 'emails' && (
        <div className="bg-white rounded-2xl p-6 shadow-lg border border-gray-200">
          <div>
            <h3 className="text-xl font-bold mb-6">Email Templates</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                'Document Request',
                'Application Status Update',
                'Meeting Confirmation',
                'Missing Document Reminder',
                'Application Approved',
                'Next Steps Instruction'
              ].map((template, idx) => (
                <div key={idx} className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 cursor-pointer">
                  <h4 className="font-semibold text-gray-900 mb-2">{template}</h4>
                  <p className="text-sm text-gray-600 mb-4">Template for {template.toLowerCase()}</p>
                  <div className="flex gap-2">
                    <button className="btn btn-xs btn-outline">Edit</button>
                    <button className="btn btn-xs btn-primary">Use</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {selectedTab === 'reminders' && (
        <div className="bg-white rounded-2xl p-6 shadow-lg border border-gray-200">
          <div>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold">Automated Reminders</h3>
              <button className="btn btn-primary gap-2">
                <BellIcon className="w-4 h-4" />
                New Reminder
              </button>
            </div>
            <div className="space-y-4">
              {[
                { client: 'Sarah Müller', type: 'Document deadline', date: '2024-07-15', active: true },
                { client: 'Michael Weber', type: 'Meeting reminder', date: '2024-07-18', active: true },
                { client: 'Anna Schmidt', type: 'Follow-up call', date: '2024-07-20', active: false },
              ].map((reminder, idx) => (
                <div key={idx} className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
                  <div>
                    <div className="font-semibold text-gray-900">{reminder.client}</div>
                    <div className="text-sm text-gray-600">{reminder.type} - {reminder.date}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <input 
                      type="checkbox" 
                      className="toggle toggle-primary" 
                      checked={reminder.active}
                      readOnly
                    />
                    <button className="btn btn-sm btn-outline">Edit</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Applications Status Tab
const ApplicationsContent = () => {
  const mockApplications = [
    { id: 'APP-2024-001', client: 'Sarah Müller', country: 'Germany', stage: 'Under Review', submittedDate: '2024-06-15', estimatedCompletion: '2024-09-15' },
    { id: 'APP-2024-002', client: 'Michael Weber', country: 'Austria', stage: 'Approved', submittedDate: '2024-05-20', estimatedCompletion: '2024-07-20' },
    { id: 'APP-2024-003', client: 'Anna Schmidt', country: 'Germany', stage: 'Documents Required', submittedDate: '2024-07-01', estimatedCompletion: '2024-10-01' },
  ];

  return (
    <div className="space-y-6">
      {/* Application Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Applications', count: 15, color: 'bg-blue-500' },
          { label: 'Under Review', count: 6, color: 'bg-yellow-500' },
          { label: 'Approved', count: 7, color: 'bg-green-500' },
          { label: 'Rejected', count: 2, color: 'bg-red-500' },
        ].map((stat, idx) => (
          <div key={idx} className="text-center p-6 bg-white rounded-2xl shadow-lg border">
            <div className={`w-16 h-16 ${stat.color} rounded-full flex items-center justify-center mx-auto mb-3`}>
              <span className="text-2xl font-bold text-white">{stat.count}</span>
            </div>
            <div className="text-sm font-semibold text-gray-700">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Applications Table */}
      <div className="bg-white rounded-2xl p-6 shadow-lg border border-gray-200">
        <div>
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-xl font-bold">Applications Status</h3>
            <button className="btn btn-primary gap-2">
              <ArrowPathIcon className="w-4 h-4" />
              Refresh Status
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="table w-full">
              <thead>
                <tr>
                  <th>Application ID</th>
                  <th>Client</th>
                  <th>Country</th>
                  <th>Stage</th>
                  <th>Submitted</th>
                  <th>Est. Completion</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {mockApplications.map((app) => (
                  <tr key={app.id} className="hover:bg-gray-50">
                    <td className="font-semibold text-primary">{app.id}</td>
                    <td>{app.client}</td>
                    <td>
                      <span className="badge badge-outline">{app.country}</span>
                    </td>
                    <td>
                      <span className={`badge ${
                        app.stage === 'Approved' ? 'badge-success' :
                        app.stage === 'Under Review' ? 'badge-warning' : 'badge-error'
                      }`}>
                        {app.stage}
                      </span>
                    </td>
                    <td>{app.submittedDate}</td>
                    <td>{app.estimatedCompletion}</td>
                    <td>
                      <div className="flex gap-1">
                        <button className="btn btn-xs btn-outline">Track</button>
                        <button className="btn btn-xs btn-primary">Details</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

// Clients Management Tab
const ClientsContent = () => {
  const mockClients = [
    { id: 1, name: 'Sarah Müller', email: 'sarah.mueller@email.com', phone: '+49 123 456789', country: 'Germany', status: 'Active', lastContact: '2 days ago' },
    { id: 2, name: 'Michael Weber', email: 'michael.weber@email.com', phone: '+43 987 654321', country: 'Austria', status: 'Active', lastContact: '1 week ago' },
    { id: 3, name: 'Anna Schmidt', email: 'anna.schmidt@email.com', phone: '+49 555 666777', country: 'Germany', status: 'Inactive', lastContact: '2 weeks ago' },
  ];

  return (
    <div className="space-y-6">
      {/* Client Controls */}
      <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="relative flex-1 max-w-md">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search clients..."
            className="input input-bordered w-full pl-10"
          />
        </div>
        <div className="flex gap-2">
          <button className="btn btn-outline gap-2">
            <FunnelIcon className="w-4 h-4" />
            Filter
          </button>
          <button className="btn btn-primary gap-2">
            <UserPlusIcon className="w-4 h-4" />
            Add Client
          </button>
        </div>
      </div>

      {/* Clients Table */}
      <div className="bg-white rounded-2xl p-6 shadow-lg border border-gray-200">
        <div>
          <div className="overflow-x-auto">
            <table className="table w-full">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Contact</th>
                  <th>Country</th>
                  <th>Status</th>
                  <th>Last Contact</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {mockClients.map((client) => (
                  <tr key={client.id} className="hover:bg-gray-50">
                    <td>
                      <div className="flex items-center gap-3">
                        <div className="avatar placeholder">
                          <div className="bg-primary text-primary-content rounded-full w-12 h-12">
                            <span className="text-lg">{client.name.charAt(0)}</span>
                          </div>
                        </div>
                        <div>
                          <div className="font-bold">{client.name}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="text-sm">
                        <div>{client.email}</div>
                        <div className="text-gray-600">{client.phone}</div>
                      </div>
                    </td>
                    <td>
                      <span className="badge badge-outline">{client.country}</span>
                    </td>
                    <td>
                      <span className={`badge ${client.status === 'Active' ? 'badge-success' : 'badge-warning'}`}>
                        {client.status}
                      </span>
                    </td>
                    <td>{client.lastContact}</td>
                    <td>
                      <div className="flex gap-1">
                        <button className="btn btn-xs btn-outline">View</button>
                        <button className="btn btn-xs btn-primary">Edit</button>
                        <button className="btn btn-xs btn-outline">Message</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

const CaseManagerPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');
  const [selectedCase, setSelectedCase] = useState<any | null>(null);
  const [showCaseDetails, setShowCaseDetails] = useState(false);

  const handleViewCase = (caseId: string) => {
    const caseData = mockFamilyData[caseId as keyof typeof mockFamilyData];
    if (caseData) {
      setSelectedCase(caseData);
      setShowCaseDetails(true);
    }
  };

  const handleBackToCases = () => {
    setShowCaseDetails(false);
    setSelectedCase(null);
  };

  const getTabContent = () => {
    if (showCaseDetails && selectedCase) {
      return <CaseDetailsView caseData={selectedCase} onBack={handleBackToCases} />;
    }

    switch (activeTab) {
      case 'dashboard':
        return <DashboardContent />;
      case 'cases':
        return <CasesContent onViewCase={handleViewCase} />;
      case 'documents':
        return <DocumentsContent />;
      case 'tasks':
        return <TasksContent />;
      case 'communications':
        return <CommunicationsContent />;
      case 'applications':
        return <ApplicationsContent />;
      case 'clients':
        return <ClientsContent />;
      default:
        return <DashboardContent />;
    }
  };

  return (
    <div className="flex-1 min-h-screen bg-white">
      {/* Header Section */}
      <div className="w-full px-4 md:px-6 pt-6 pb-4">
        <div className="bg-white rounded-3xl p-6 shadow-lg border border-gray-200">
          <div className="p-6 md:p-8">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
              {/* Left side - Title and Description */}
              <div className="flex-1">
                <div className="flex items-center gap-4 mb-4">
                  <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600 shadow-lg">
                    <UserIcon className="w-8 h-8 text-white" />
                  </div>
                  <div>
                    <h1 className="text-3xl md:text-4xl font-bold text-gray-900">Case Manager Dashboard</h1>
                    <p className="text-lg text-gray-600 mt-1">German & Austrian Citizenship Applications</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                  <div className="flex items-center gap-2">
                    <FolderIcon className="w-5 h-5 text-blue-500" />
                    <span className="text-gray-600">Active Cases: <span className="font-bold text-gray-900">24</span></span>
                  </div>
                  <div className="flex items-center gap-2">
                    <ClockIcon className="w-5 h-5 text-orange-500" />
                    <span className="text-gray-600">Pending Tasks: <span className="font-bold text-gray-900">7</span></span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircleIcon className="w-5 h-5 text-green-500" />
                    <span className="text-gray-600">Completed Today: <span className="font-bold text-gray-900">3</span></span>
                  </div>
                </div>
              </div>
              
              {/* Right side - Quick Actions */}
              <div className="flex flex-col gap-3">
                <button className="btn btn-primary gap-2 shadow-lg">
                  <PlusIcon className="w-5 h-5" />
                  New Case
                </button>
                <button className="btn btn-outline gap-2">
                  <DocumentArrowUpIcon className="w-5 h-5" />
                  Upload Documents
                </button>
                <button className="btn btn-outline gap-2">
                  <CalendarIcon className="w-5 h-5" />
                  Schedule Meeting
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* Tabs Navigation */}
      <div className="w-full px-4 md:px-6 pb-4">
        <div className="bg-white rounded-2xl p-6 shadow-lg border border-gray-200">
          <div className="p-2">
            {/* Desktop version */}
            <div className="hidden md:flex gap-2">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-semibold transition-all duration-300 ${
                    activeTab === tab.id 
                      ? 'bg-blue-600 text-white shadow-lg transform scale-105' 
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                  }`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  <tab.icon className="w-5 h-5" />
                  <span>{tab.label}</span>
                </button>
              ))}
            </div>
            
            {/* Mobile version */}
            <div className="md:hidden">
              <div className="overflow-x-auto scrollbar-hide">
                <div className="flex gap-2 min-w-max p-2">
                  {tabs.map((tab) => {
                    const isActive = activeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        className={`flex flex-col items-center justify-center gap-1 px-3 py-3 rounded-xl min-w-[80px] font-semibold transition-all duration-300 ${
                          isActive 
                            ? 'bg-blue-600 text-white shadow-lg transform scale-105' 
                            : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                        }`}
                        onClick={() => setActiveTab(tab.id)}
                      >
                        <tab.icon className="w-6 h-6" />
                        <span className="text-xs">{tab.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* Tab Content */}
      <div className="w-full flex-1 px-4 md:px-6 pb-8">
        <div key={showCaseDetails ? 'case-details' : activeTab} className="animate-fade-in">
          {getTabContent()}
        </div>
      </div>
    </div>
  );
};

export default CaseManagerPage;

// Add custom styles for animations
const styles = `
  .animate-fade-in {
    animation: fadeIn 0.3s ease-in-out;
  }
  
  .scrollbar-hide {
    -ms-overflow-style: none;
    scrollbar-width: none;
  }
  
  .scrollbar-hide::-webkit-scrollbar {
    display: none;
  }
  
  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
`;

// Add styles to document head
if (typeof document !== 'undefined') {
  const styleSheet = document.createElement('style');
  styleSheet.textContent = styles;
  document.head.appendChild(styleSheet);
} 