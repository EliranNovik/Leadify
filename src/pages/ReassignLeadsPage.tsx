import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeftIcon } from '@heroicons/react/24/solid';
import ReassignLeadsReport from '../components/reports/ReassignLeadsReport';

const ReassignLeadsPage = () => {
  return (
    // Grey canvas with white panels floating on it, the same shell the pipeline pages use. The
    // horizontal inset matches the report's own padding so the heading lines up with the panels.
    <div className="min-h-full w-full bg-[#f3f4f6]">
      <div className="flex flex-col gap-4 px-4 pt-6 sm:flex-row sm:items-center sm:justify-between md:px-6">
        <h1 className="text-3xl font-bold">Re-assign leads</h1>
        <Link
          to="/reports"
          className="btn btn-ghost btn-sm self-start sm:self-auto"
        >
          <ArrowLeftIcon className="w-4 h-4 mr-2" />
          Back to Reports
        </Link>
      </div>
      <ReassignLeadsReport />
    </div>
  );
};

export default ReassignLeadsPage;
