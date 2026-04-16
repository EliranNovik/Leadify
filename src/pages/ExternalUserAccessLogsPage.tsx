import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeftIcon } from '@heroicons/react/24/solid';
import ExternalUserAccessLogs from '../components/ExternalUserAccessLogs';
import { supabase } from '../lib/supabase';

const ExternalUserAccessLogsPage = () => {
  const [authUserId, setAuthUserId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getUser().then(({ data }) => {
      if (!cancelled) setAuthUserId(data.user?.id ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-white pt-16">
      <div className="container mx-auto px-4 py-6">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-3xl font-bold text-gray-900">Access Logs</h1>
          <Link to="/external-home" className="btn btn-ghost btn-sm self-start sm:self-auto">
            <ArrowLeftIcon className="mr-2 h-4 w-4" />
            Back to Dashboard
          </Link>
        </div>
        {authUserId ? (
          <ExternalUserAccessLogs key={authUserId} storageScope={authUserId} showFullView={true} />
        ) : (
          <div className="flex justify-center py-16">
            <span className="loading loading-spinner loading-lg text-primary" />
          </div>
        )}
      </div>
    </div>
  );
};

export default ExternalUserAccessLogsPage;
