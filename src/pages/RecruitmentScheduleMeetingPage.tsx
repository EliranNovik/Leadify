import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import RecruitmentMeetingForm from '../components/meeting/RecruitmentMeetingForm';
import {
  buildRecruitmentCandidatePath,
  candidateDisplayName,
} from '../lib/recruitmentCandidates';
import { fetchRecruitmentUserById } from '../lib/recruitmentDigitalContracts';

const RecruitmentScheduleMeetingPage: React.FC = () => {
  const { userId: rawUserId } = useParams<{ userId: string }>();
  const userId = rawUserId ? decodeURIComponent(rawUserId) : '';
  const navigate = useNavigate();
  const [name, setName] = useState('Candidate');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const user = await fetchRecruitmentUserById(userId);
        if (!cancelled && user) setName(candidateDisplayName(user));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const back = () => navigate(buildRecruitmentCandidatePath(userId));

  if (!userId) {
    return <div className="p-8 text-center text-gray-500">Missing candidate.</div>;
  }

  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-[#ececec] px-4 py-6 lg:pl-8">
      <button
        type="button"
        className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900"
        onClick={back}
      >
        <ArrowLeftIcon className="h-4 w-4" />
        Back to candidate
      </button>
      {loading ? (
        <div className="flex justify-center py-16">
          <span className="loading loading-spinner loading-md text-emerald-600" />
        </div>
      ) : (
        <RecruitmentMeetingForm
          userId={userId}
          candidateName={name}
          mode="schedule"
          onComplete={back}
          onCancel={back}
        />
      )}
    </div>
  );
};

export default RecruitmentScheduleMeetingPage;
