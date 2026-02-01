import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeftIcon } from '@heroicons/react/24/solid';
import ReassignLeadsReport from '../components/reports/ReassignLeadsReport';

const ReassignLeadsPage = () => {
  return (
    <div>
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
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
