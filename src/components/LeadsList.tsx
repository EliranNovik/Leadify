import React from 'react';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';

interface Lead {
  id: number;
  leadNumber: string;
  info: string;
  staff: string[];
  name: string;
  topic: string;
  date: string;
}

const mockLeads: Lead[] = [
  {
    id: 1,
    leadNumber: 'L122325',
    info: 'New Lead',
    staff: ['Yael'],
    name: 'Mark Ehrlich',
    topic: 'German Citizenship',
    date: '2024-03-15',
  },
  {
    id: 2,
    leadNumber: 'L122326',
    info: 'New Lead',
    staff: ['YehonatanD'],
    name: 'Jane Granek',
    topic: 'German Citizenship',
    date: '2024-03-14',
  },
  {
    id: 3,
    leadNumber: 'L122327',
    info: 'Hot Lead',
    staff: ['Tzvya'],
    name: ' Ida Bloch',
    topic: 'Proposal Discussion',
    date: '2024-03-13',
  },
];

const LeadsList: React.FC = () => {
  return (
    <div className="bg-base-100 rounded-lg shadow-lg p-2 md:p-4 w-full max-w-full">
      <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
        <ExclamationTriangleIcon className="w-6 h-6 text-warning" />
        Overdue Followups
      </h2>
      <div className="overflow-x-auto">
        <table className="table table-zebra w-full">
          <thead>
            <tr>
              <th>Lead</th>
              <th>Info</th>
              <th>Name</th>
              <th>Staff</th>
              <th>Topic</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {mockLeads.map((lead) => (
              <tr key={lead.id}>
                <td className="font-medium text-primary">{lead.leadNumber}</td>
                <td>
                  <div className="badge badge-primary whitespace-nowrap px-4">{lead.info}</div>
                </td>
                <td className="font-medium">{lead.name}</td>
                <td>
                  <div className="flex flex-col gap-1">
                    {lead.staff.map((staffMember, idx) => (
                      <span key={idx} className="text-sm">{staffMember}</span>
                    ))}
                  </div>
                </td>
                <td>{lead.topic}</td>
                <td>{lead.date}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default LeadsList; 