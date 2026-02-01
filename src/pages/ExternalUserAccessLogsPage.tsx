import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeftIcon } from '@heroicons/react/24/solid';
import ExternalUserAccessLogs from '../components/ExternalUserAccessLogs';

const ExternalUserAccessLogsPage = () => {
  return (
    <div className="min-h-screen bg-white pt-16">
      <div className="container mx-auto px-4 py-6">
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <h1 className="text-3xl font-bold text-gray-900">Access Logs</h1>
          <Link
            to="/"
            className="btn btn-ghost btn-sm self-start sm:self-auto"
          >
            <ArrowLeftIcon className="w-4 h-4 mr-2" />
            Back to Dashboard
          </Link>
        </div>
        <ExternalUserAccessLogs showFullView={true} />
      </div>
    </div>
  );
};

export default ExternalUserAccessLogsPage;
